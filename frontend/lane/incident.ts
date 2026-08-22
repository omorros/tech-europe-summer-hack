/**
 * One incident at a time, on this Worker.
 *
 * FastAPI still exists for a live H-agent run on a laptop. The console only
 * needs HTTP + a WebSocket + the warmed cache, and those fit in a Durable
 * Object next to the Next.js assets — which is why the deployed UI no longer
 * waits on BACKEND_ORIGIN.
 */

import { briefLines, coverageOf, scriptOf } from "./briefing";
import { Dedupe, extract, type Entity } from "./extract";
import { matchRoom, planRoute, type Approach, type RoomGraph } from "./route";
import { walkPayload } from "./walk";

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  INCIDENT: DurableObjectNamespace;
  BACKEND_ORIGIN?: string;
  PUBLIC_ORIGIN?: string;
  WALKTHROUGH_URL?: string;
  WALKTHROUGH_TOKEN?: string;
}

const DEFAULT_ADDRESS = "22 Kellett Road, London SW2 1EB";
const CALL_LINES = [
  "hello there's a fire please help",
  "we're at {address}",
  "my mum's still inside she's upstairs in the back bedroom she can't walk",
  "it started in the kitchen there's a gas bottle by the cooker",
  "the stairs are full of smoke and the back door's blocked",
];
const AGENT_STEPS = [
  ["navigate", "Opening the sold-prices search"],
  ["type", "Entering the postcode"],
  ["click", "Selecting the matching address"],
  ["extract", "Saving interior photos and the floor plan"],
] as const;

type Frame = {
  type: string;
  ts: number;
  payload: unknown;
  seq: number;
  boot: string;
};

function slugify(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Spoken "14 Deerdale Road SE24 0AW" must hit `14-deerdale-road-london-se24-0aw`. */
function pickSlug(spoken: string, slugs: string[]): string | null {
  const tokens = spoken.split("-").filter(Boolean);
  if (!tokens.length) return null;
  let best: { slug: string; score: number } | null = null;
  for (const candidate of slugs) {
    const parts = candidate.split("-");
    if (parts[0] !== tokens[0]) continue;
    const overlap = tokens.filter((token) => parts.includes(token)).length;
    const score = overlap / tokens.length;
    if (score < 0.8) continue;
    if (!best || score > best.score) best = { slug: candidate, score };
  }
  return best?.slug ?? null;
}

function sleep(ms: number): Promise<void> {
  const wait = (globalThis as { scheduler?: { wait: (ms: number) => Promise<void> } }).scheduler
    ?.wait;
  return wait ? wait(ms) : new Promise((resolve) => setTimeout(resolve, ms));
}

export class IncidentHub {
  private boot = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  private seq = 0;
  private recent: Frame[] = [];
  private generation = 0;
  private callId: string | null = null;
  private address: string | null = null;
  private entities: Entity[] = [];
  private approach: Approach | null = null;
  private artifacts: {
    address?: string;
    photos?: { id?: string; url?: string; room_id?: string | null }[];
  } | null = null;
  private graph: RoomGraph | null = null;
  private route: ReturnType<typeof planRoute> | null = null;
  private briefing: Record<string, unknown> | null = null;
  private walk: { fire_room?: string; legs?: unknown[] } | null = null;
  private lanesStarted = false;
  private walkStarted = false;
  private briefed = false;
  private ended = false;
  private phoneOwner: string | null = null;
  private dedupe = new Dedupe();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health" && request.method === "GET") {
      return Response.json({
        ok: true,
        service: "lantern-backend",
        boot: this.boot,
        consoles: this.ctx.getWebSockets("console").length,
        call_id: this.callId,
        address: this.address,
      });
    }

    if (path === "/incident" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        address?: string;
        replay?: boolean;
      };
      const address = body.replay ? DEFAULT_ADDRESS : body.address || DEFAULT_ADDRESS;
      return Response.json(await this.startIncident(address, true));
    }

    if (path === "/radio" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { text?: string };
      const fired = body.text ? await this.onRadio(body.text) : [];
      return Response.json({ ok: true, entities: fired });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.acceptSocket(path.startsWith("/ws/phone") ? "phone" : "console");
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const tags = this.ctx.getTags(socket);
    if (tags.includes("console") && message.type === "radio.update") {
      const payload = message.payload as { text?: string } | undefined;
      const line = payload?.text || String(message.text || "");
      if (line) await this.onRadio(line);
      return;
    }
    if (!tags.includes("phone")) return;

    if (message.type === "call.start") {
      const payload = message.payload as { address?: string } | undefined;
      const address = String(payload?.address || message.address || "");
      const started = await this.startIncident(address, false);
      this.phoneOwner = started.call_id;
      socket.send(
        JSON.stringify({
          type: "ack",
          call_id: started.call_id,
          address: started.address,
        }),
      );
    } else if (message.type === "transcript") {
      const payload = message.payload as { text?: string } | undefined;
      const line = String(payload?.text || message.text || "");
      if (line) {
        const seq = typeof message.seq === "number" ? message.seq : 0;
        await this.ingest(line, seq, message.is_final !== false);
        this.phoneOwner = this.phoneOwner || this.callId;
      }
    } else if (message.type === "call.end") {
      if (this.phoneOwner && this.phoneOwner === this.callId) await this.endCall();
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(socket);
    if (tags.includes("phone") && this.phoneOwner && this.phoneOwner === this.callId) {
      await this.endCall();
    }
  }

  private acceptSocket(tag: "console" | "phone"): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [tag]);
    if (tag === "console") {
      pair[1].send(
        JSON.stringify({ type: "_hello", boot: this.boot, seq: this.seq, ts: Date.now() / 1000 }),
      );
      for (const frame of this.recent) pair[1].send(JSON.stringify(frame));
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private emit(type: string, payload: unknown): void {
    this.seq += 1;
    const frame: Frame = {
      type,
      ts: Date.now() / 1000,
      payload,
      seq: this.seq,
      boot: this.boot,
    };
    this.recent.push(frame);
    if (this.recent.length > 400) this.recent.shift();
    for (const socket of this.ctx.getWebSockets("console")) {
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        /* dropped client */
      }
    }
  }

  private bump(): number {
    this.generation += 1;
    this.callId = null;
    this.address = null;
    this.entities = [];
    this.approach = null;
    this.artifacts = null;
    this.graph = null;
    this.route = null;
    this.briefing = null;
    this.walk = null;
    this.lanesStarted = false;
    this.walkStarted = false;
    this.briefed = false;
    this.ended = false;
    this.phoneOwner = null;
    this.dedupe.reset();
    this.recent = [];
    return this.generation;
  }

  private alive(generation: number): boolean {
    return generation === this.generation;
  }

  private async startIncident(address: string, scripted: boolean) {
    const generation = this.bump();
    const trimmed = address.trim();
    const resolved = trimmed
      ? await this.resolveAddress(trimmed)
      : scripted
        ? await this.resolveAddress(DEFAULT_ADDRESS)
        : null;
    this.callId = `999-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    this.address = resolved;

    this.emit("status", { stage: "call", state: "running", message: "Line open" });
    this.emit("call.incoming", { call_id: this.callId });
    this.emit("call.answered", { call_id: this.callId });

    if (resolved) {
      this.ctx.waitUntil(this.runLanes(generation, resolved));
      if (scripted) this.ctx.waitUntil(this.playScript(generation, resolved));
    }
    return { call_id: this.callId, address: resolved };
  }

  private async playScript(generation: number, address: string): Promise<void> {
    for (let seq = 0; seq < CALL_LINES.length; seq++) {
      if (!this.alive(generation)) return;
      await this.ingest(CALL_LINES[seq].replace("{address}", address.toLowerCase()), seq, true);
      await sleep(1400);
    }
    if (this.alive(generation)) await this.endCall();
  }

  private async ingest(text: string, seq: number, isFinal: boolean): Promise<Entity[]> {
    if (!this.callId) await this.startIncident("", false);
    const generation = this.generation;
    this.emit("transcript.fragment", {
      call_id: this.callId,
      seq,
      text,
      is_final: isFinal,
      speaker: "caller",
    });
    const fired = this.extractFrom(text, "call");
    if (!this.alive(generation)) return fired;

    if (!this.lanesStarted) {
      const spoken = [...this.entities].reverse().find((entity) => entity.type === "ADDRESS");
      if (spoken) {
        const resolved = await this.resolveAddress(spoken.value);
        if (resolved) this.ctx.waitUntil(this.runLanes(generation, resolved));
      }
    }

    if (
      this.graph &&
      fired.some((entity) =>
        ["VICTIM_LOCATION", "FIRE_ORIGIN", "HAZARD_TYPE", "EXIT"].includes(entity.type),
      )
    ) {
      this.tryRoute();
      this.tryBriefing();
      this.ctx.waitUntil(this.ensureWalkthrough(generation));
    }
    return fired;
  }

  private async onRadio(text: string): Promise<Entity[]> {
    this.emit("radio.update", { text });
    const generation = this.generation;
    const fired = this.extractFrom(text, "radio");
    if (!this.alive(generation)) return fired;
    if (this.graph) {
      this.tryRoute();
      this.tryBriefing(true);
    }
    return fired;
  }

  private async endCall(): Promise<void> {
    if (!this.callId || this.ended) return;
    this.ended = true;
    this.emit("call.ended", { call_id: this.callId });
    this.emit("status", { stage: "call", state: "done", message: "Caller hung up" });
    this.tryBriefing(true);
  }

  private extractFrom(text: string, source: "call" | "radio"): Entity[] {
    this.emit("status", { stage: "extract", state: "running", message: "keyword extractor" });
    const fired: Entity[] = [];
    for (const hit of extract(text)) {
      if (!this.dedupe.check(hit.type, hit.value)) continue;
      const entity: Entity = { ...hit, source, ts: Date.now() / 1000 };
      this.entities.push(entity);
      this.emit("entity.extracted", entity);
      fired.push(entity);
    }
    this.emit("status", {
      stage: "extract",
      state: "done",
      message: "keyword extractor · 0ms",
    });
    return fired;
  }

  private async runLanes(generation: number, address: string): Promise<void> {
    if (this.lanesStarted) return;
    this.lanesStarted = true;
    this.address = address;

    const loaded = await this.loadProperty(address);
    if (!this.alive(generation) || !loaded) {
      this.emit("status", {
        stage: "agent",
        state: "error",
        message: "No cached listing for this address on the Worker",
      });
      return;
    }

    this.emit("status", { stage: "approach", state: "running", message: "Reading the street" });
    this.approach = loaded.approach;
    this.emit("approach.ready", loaded.approach);
    this.emit("status", { stage: "approach", state: "done", message: "Cached Street View" });

    this.emit("status", { stage: "agent", state: "running", message: "Opening the listing" });
    for (let i = 0; i < AGENT_STEPS.length; i++) {
      if (!this.alive(generation)) return;
      const [action, thought] = AGENT_STEPS[i];
      this.emit("agent.step", { step: i + 1, action, thought, screenshot_url: "" });
      await sleep(350);
    }
    this.artifacts = loaded.artifacts;
    this.emit("agent.artifacts", loaded.artifacts);
    this.emit("status", { stage: "agent", state: "done", message: "Cached listing" });

    this.emit("status", { stage: "rooms", state: "running", message: "Reading the floor plan" });
    this.graph = loaded.graph;
    this.emit("rooms.graph", loaded.graph);
    this.emit("status", { stage: "rooms", state: "done", message: "Cached room graph" });

    this.walk = loaded.walk;
    this.tryRoute();
    this.tryBriefing();
    this.ctx.waitUntil(this.ensureWalkthrough(generation));
  }

  private tryRoute(): void {
    if (!this.graph) return;
    const victim = [...this.entities].reverse().find((entity) => entity.type === "VICTIM_LOCATION");
    if (!victim) return;
    const hazards = this.entities.filter((entity) =>
      ["FIRE_ORIGIN", "HAZARD_TYPE", "EXIT"].includes(entity.type),
    );
    this.emit("status", { stage: "route", state: "running", message: "Planning entry" });
    this.route = planRoute(this.graph, victim, hazards, this.approach);
    this.emit("route.planned", this.route);
    this.emit("status", { stage: "route", state: "done", message: "Route planned" });
  }

  private tryBriefing(force = false): void {
    if (!this.route) return;
    if (this.briefed && !force) return;
    this.emit("status", { stage: "briefing", state: "running", message: "Writing the crew card" });
    const incident = {
      address: this.address ?? "",
      entities: this.entities,
      approach: this.approach,
      route: this.route,
      room_graph: this.graph,
    };
    const script = scriptOf(incident);
    const briefing: Record<string, unknown> = {
      video_url: "",
      captions_url: "",
      duration_s: Math.round((script.split(/\s+/).length / 2.6) * 10) / 10,
      script,
      lines: briefLines(incident),
    };
    const coverage = this.graph
      ? coverageOf(this.graph, this.artifacts, this.route, this.approach)
      : null;
    if (coverage) briefing.coverage = coverage;
    const fire = [...this.entities].reverse().find((entity) => entity.type === "FIRE_ORIGIN");
    const fireRoom = fire && this.graph ? matchRoom(this.graph, fire.value) : null;
    if (this.walk?.legs && (!this.walk.fire_room || this.walk.fire_room === fireRoom)) {
      briefing.legs = this.walk.legs;
    }
    this.briefing = briefing;
    this.briefed = true;
    this.emit("briefing.ready", briefing);
    this.emit("status", {
      stage: "briefing",
      state: "done",
      message: briefing.legs ? "Crew card ready · walkthrough running" : "Crew card ready",
    });
  }

  private fireRoom(): string | null {
    const fire = [...this.entities].reverse().find((entity) => entity.type === "FIRE_ORIGIN");
    return fire && this.graph ? matchRoom(this.graph, fire.value) : null;
  }

  private publishWalk(legs: unknown[]): void {
    const playable = (legs as { video_url?: string }[]).filter((leg) => leg.video_url);
    if (!playable.length) return;
    this.walk = { ...(this.walk ?? {}), legs: playable };
    if (!this.briefing) return;
    this.briefing = { ...this.briefing, legs: playable };
    this.emit("briefing.ready", this.briefing);
  }

  private async ensureWalkthrough(generation: number): Promise<void> {
    if (this.walkStarted || !this.alive(generation)) return;
    this.walkStarted = true;

    const cached = this.walk?.legs as { video_url?: string }[] | undefined;
    if (cached?.some((leg) => leg.video_url)) {
      this.emit("status", {
        stage: "briefing",
        state: "running",
        message: "Walkthrough rendering",
      });
      this.publishWalk(cached);
      this.emit("status", { stage: "briefing", state: "done", message: "Walkthrough ready" });
      return;
    }

    const url = (this.env.WALKTHROUGH_URL || "").replace(/\/$/, "");
    if (!url || !this.graph || !this.artifacts) return;

    const origin = (this.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
    const routeIds = (this.route?.waypoints ?? [])
      .map((waypoint) => waypoint.room_id)
      .filter((id): id is string => Boolean(id));
    const payload = walkPayload(
      origin,
      this.address ?? "",
      this.graph,
      this.artifacts,
      this.approach,
      this.entities
        .filter((entity) => ["FIRE_ORIGIN", "HAZARD_TYPE", "EXIT"].includes(entity.type))
        .map((entity) => entity.value),
      this.fireRoom(),
      routeIds,
    );
    if (!payload.route[0] || !payload.photos[payload.route[0].room_id]) return;

    this.emit("status", {
      stage: "briefing",
      state: "running",
      message: "Walkthrough rendering",
    });
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.env.WALKTHROUGH_TOKEN) {
        headers.Authorization = `Bearer ${this.env.WALKTHROUGH_TOKEN}`;
      }
      const submitted = await fetch(`${url}/walkthrough`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!submitted.ok) {
        this.emit("status", {
          stage: "briefing",
          state: "error",
          message: `Walkthrough refused (${submitted.status})`,
        });
        return;
      }
      const job = (await submitted.json()) as { job_id: string };
      for (let i = 0; i < 40 && this.alive(generation); i++) {
        await sleep(8000);
        const live = await fetch(`${url}/walkthrough/${job.job_id}`, { headers });
        if (!live.ok) continue;
        const state = (await live.json()) as {
          status?: string;
          legs?: { video_url?: string }[];
        };
        if (state.legs?.some((leg) => leg.video_url)) this.publishWalk(state.legs);
        if (state.status === "COMPLETED" || state.status === "PARTIAL") break;
      }
      this.emit("status", {
        stage: "briefing",
        state: this.walk?.legs ? "done" : "error",
        message: this.walk?.legs ? "Walkthrough ready" : "Walkthrough produced no video",
      });
    } catch (error) {
      this.emit("status", {
        stage: "briefing",
        state: "error",
        message: String(error).slice(0, 200),
      });
    }
  }

  private async resolveAddress(address: string): Promise<string | null> {
    const raw = address.trim();
    if (!raw) return null;
    const slug = slugify(raw);
    const exact = await this.readJson(`/cache/${slug}/artifacts.json`);
    if (exact?.address) return String(exact.address);

    const index = (await this.readJson("/cache/index.json")) as { slugs?: string[] } | null;
    const hit = pickSlug(slug, index?.slugs ?? []);
    if (hit) {
      const data = await this.readJson(`/cache/${hit}/artifacts.json`);
      return data?.address ? String(data.address) : raw;
    }
    return exact ? raw : null;
  }

  private async loadProperty(address: string) {
    const slug = slugify(address);
    const [approach, artifacts, graph, walk] = await Promise.all([
      this.readJson(`/cache/${slug}/approach.json`),
      this.readJson(`/cache/${slug}/artifacts.json`),
      this.readJson(`/cache/${slug}/rooms.json`),
      this.readJson(`/cache/${slug}/walkthrough.json`),
    ]);
    if (!artifacts || !graph) return null;
    return {
      approach: (approach ?? { coverage: false }) as Approach,
      artifacts,
      graph: graph as RoomGraph,
      walk: walk as { fire_room?: string; legs?: unknown[] } | null,
    };
  }

  private async readJson(path: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.env.ASSETS.fetch(new Request(`https://assets.local${path}`));
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
