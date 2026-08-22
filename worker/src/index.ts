/**
 * SizeUp walkthrough Worker.
 *
 * Turns a route through a building into a firefighter's-eye walkthrough
 * video, entrance to seat of fire, one clip per hop.
 *
 *   POST /walkthrough            -> {job_id, legs[]}   (returns immediately)
 *   GET  /walkthrough/{job_id}   -> job state + clip URLs as they land
 *   POST /webhook/fal/{job}/{n}  -> fal calls this when a leg finishes
 *   GET  /health
 *
 * Why a Worker at all: it keeps FAL_KEY off the dispatch laptop, gives fal a
 * public HTTPS webhook target (the laptop is behind a phone hotspot and has
 * no inbound route), and survives the laptop being closed mid-render.
 *
 * State lives in KV under one key per leg, never a shared mutable document,
 * because several legs finish at once and a read-modify-write on a single key
 * would silently lose clips.
 */

import { result as falResult, submit, status as falStatus, videoUrl } from "./fal";
import {
  adapterFor,
  ADAPTERS,
  autoSeconds,
  DEFAULT_MODEL,
  estimateUsd,
  snapDuration,
} from "./models";
import { verifyFalWebhook } from "./verify";
import {
  buildLegs,
  legNarration,
  type Leg,
  type WalkthroughRequest,
} from "./walkthrough";

export interface Env {
  SIZEUP_JOBS: KVNamespace;
  FAL_KEY: string;
  /** Shared secret callers must send as Authorization: Bearer … */
  WORKER_TOKEN?: string;
  /** Public origin of this Worker, for building webhook URLs. */
  PUBLIC_URL?: string;
  /** Override the video model. */
  VIDEO_MODEL?: string;
  /** Hard ceiling per walkthrough, USD. The fal voucher is shared. */
  MAX_USD?: string;
  /** Target total walkthrough length, seconds, spread across the legs. */
  TARGET_SECONDS?: string;
}

const JOB_TTL_SECONDS = 60 * 60 * 24;

interface JobManifest {
  job_id: string;
  created_at: string;
  address?: string;
  model: string;
  estimated_usd: number;
  seconds_per_leg: number;
  total_seconds: number;
  legs: Leg[];
  narration: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });

function authorised(request: Request, env: Env): boolean {
  if (!env.WORKER_TOKEN) return true; // unset = open, fine for a local demo
  const header = request.headers.get("Authorization") ?? "";
  return header === `Bearer ${env.WORKER_TOKEN}`;
}

const manifestKey = (jobId: string) => `job:${jobId}`;
const legKey = (jobId: string, index: number) => `job:${jobId}:leg:${index}`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return json({}, 204);
    if (path === "/health") {
      return json({ ok: true, model: env.VIDEO_MODEL ?? DEFAULT_MODEL });
    }

    // fal -> us. Verified by signature, not by the shared token.
    const webhookMatch = path.match(/^\/webhook\/fal\/([^/]+)\/(\d+)$/);
    if (webhookMatch && request.method === "POST") {
      return handleWebhook(request, env, webhookMatch[1], Number(webhookMatch[2]));
    }

    if (!authorised(request, env)) return json({ error: "unauthorised" }, 401);

    if (path === "/walkthrough" && request.method === "POST") {
      return startWalkthrough(request, env, ctx);
    }

    const jobMatch = path.match(/^\/walkthrough\/([^/]+)$/);
    if (jobMatch && request.method === "GET") {
      return getWalkthrough(env, jobMatch[1]);
    }

    return json({ error: "not found" }, 404);
  },
};

async function startWalkthrough(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: WalkthroughRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  let legs: Leg[];
  try {
    legs = buildLegs(body);
  } catch (error) {
    return json({ error: String((error as Error).message) }, 400);
  }

  const jobId = crypto.randomUUID();
  // Per-request override lets us spend on Veo for the one hero clip while the
  // rest of the route runs on Kling.
  const model = (body as any).model ?? env.VIDEO_MODEL ?? DEFAULT_MODEL;
  const adapter = adapterFor(model);
  const origin = env.PUBLIC_URL ?? new URL(request.url).origin;

  // Veo cannot render a leg without both frames; Kling can extrapolate from
  // the start frame alone. Fail loudly rather than submitting something the
  // model will reject.
  if (adapter.requiresEndFrame) {
    const missing = legs.filter((leg) => !leg.end_image_url).map((leg) => leg.label);
    if (missing.length) {
      return json(
        {
          error: `${model} requires an end frame on every leg; missing for: ${missing.join(", ")}`,
          hint: "use fal-ai/kling-video/o1/image-to-video, which treats the end frame as optional",
        },
        400,
      );
    }
  }

  // Buildings vary: a flat is one hop, a large house can be ten. Unless the
  // caller pinned seconds_per_leg, spread a target total across however many
  // legs this building actually has.
  const target = Number(env.TARGET_SECONDS ?? 30);
  const seconds =
    body.seconds_per_leg !== undefined
      ? snapDuration(adapter, body.seconds_per_leg)
      : autoSeconds(adapter, legs.length, target);

  const estimated = estimateUsd(adapter, legs.length, seconds);
  const ceiling = Number(env.MAX_USD ?? 30);
  if (!Number.isFinite(estimated)) {
    // An unmapped model has no known price, so the ceiling cannot be enforced.
    // Refuse rather than spend an unknown amount of a shared voucher.
    return json(
      {
        error: `no pricing known for "${model}", so the $${ceiling.toFixed(2)} ceiling cannot be enforced`,
        hint: "add it to ADAPTERS in src/models.ts with its per-second price, or use a mapped model",
        mapped_models: Object.keys(ADAPTERS),
      },
      400,
    );
  }
  if (estimated > ceiling) {
    return json(
      {
        error: `this route would cost $${estimated.toFixed(2)}, over the $${ceiling.toFixed(2)} ceiling`,
        leg_count: legs.length,
        seconds_per_leg: seconds,
        hint: "shorten the route, lower seconds_per_leg, or raise MAX_USD — the fal voucher is shared with the reconstruction lane",
      },
      402,
    );
  }

  // Submit every leg up front. Queue submits return immediately with a
  // request_id, so this is N fast round-trips, not N renders.
  const submitted = await Promise.all(
    legs.map(async (leg) => {
      const input = adapter.build({
        prompt: leg.prompt,
        startImageUrl: leg.start_image_url,
        endImageUrl: leg.end_image_url,
        seconds,
      });

      try {
        const submission = await submit(
          env.FAL_KEY,
          model,
          input,
          `${origin}/webhook/fal/${jobId}/${leg.index}`,
        );
        return {
          ...leg,
          request_id: submission.request_id,
          status_url: submission.status_url,
          response_url: submission.response_url,
          status: "IN_QUEUE" as const,
        };
      } catch (error) {
        return { ...leg, status: "ERROR" as const, error: String((error as Error).message) };
      }
    }),
  );

  const manifest: JobManifest = {
    job_id: jobId,
    created_at: new Date().toISOString(),
    address: body.address,
    model,
    estimated_usd: Number.isFinite(estimated) ? Number(estimated.toFixed(2)) : 0,
    seconds_per_leg: seconds,
    total_seconds: seconds * submitted.length,
    legs: submitted,
    narration: submitted.map((leg) => legNarration(leg, body)),
  };

  ctx.waitUntil(
    Promise.all([
      env.SIZEUP_JOBS.put(manifestKey(jobId), JSON.stringify(manifest), {
        expirationTtl: JOB_TTL_SECONDS,
      }),
      ...submitted.map((leg) =>
        env.SIZEUP_JOBS.put(
          legKey(jobId, leg.index),
          JSON.stringify({ status: leg.status, request_id: leg.request_id, error: leg.error }),
          { expirationTtl: JOB_TTL_SECONDS },
        ),
      ),
    ]),
  );

  return json({
    job_id: jobId,
    status: submitted.some((l) => l.status === "ERROR") ? "PARTIAL" : "IN_QUEUE",
    model,
    leg_count: submitted.length,
    seconds_per_leg: seconds,
    total_seconds: manifest.total_seconds,
    estimated_usd: manifest.estimated_usd,
    poll: `${origin}/walkthrough/${jobId}`,
    legs: submitted.map(({ index, label, status, error }) => ({ index, label, status, error })),
  });
}

async function getWalkthrough(env: Env, jobId: string): Promise<Response> {
  const raw = await env.SIZEUP_JOBS.get(manifestKey(jobId));
  if (!raw) return json({ error: "unknown job" }, 404);
  const manifest: JobManifest = JSON.parse(raw);

  const legs = await Promise.all(
    manifest.legs.map(async (leg) => {
      const stored = await env.SIZEUP_JOBS.get(legKey(jobId, leg.index));
      const state = stored ? JSON.parse(stored) : {};

      // KV is eventually consistent and a webhook can be lost, so a leg that
      // still looks unfinished gets checked against fal directly.
      if (!state.video_url && leg.request_id && state.status !== "ERROR") {
        try {
          const live = await falStatus(
            env.FAL_KEY, manifest.model, leg.request_id, leg.status_url);
          if (live.status === "COMPLETED") {
            const payload = await falResult(
              env.FAL_KEY, manifest.model, leg.request_id, leg.response_url);
            const url = videoUrl(payload);
            if (url) {
              state.status = "COMPLETED";
              state.video_url = url;
              await env.SIZEUP_JOBS.put(legKey(jobId, leg.index), JSON.stringify(state), {
                expirationTtl: JOB_TTL_SECONDS,
              });
            }
          } else {
            state.status = live.status;
          }
        } catch (error) {
          state.poll_error = String((error as Error).message);
        }
      }

      return {
        index: leg.index,
        label: leg.label,
        from_room_id: leg.from_room_id,
        to_room_id: leg.to_room_id,
        narration: manifest.narration[leg.index],
        status: state.status ?? leg.status,
        video_url: state.video_url ?? null,
        error: state.error ?? state.poll_error ?? null,
      };
    }),
  );

  const done = legs.filter((l) => l.video_url).length;
  return json({
    job_id: jobId,
    address: manifest.address,
    model: manifest.model,
    created_at: manifest.created_at,
    seconds_per_leg: manifest.seconds_per_leg,
    total_seconds: manifest.total_seconds,
    estimated_usd: manifest.estimated_usd,
    status: done === legs.length ? "COMPLETED" : legs.some((l) => l.error) ? "PARTIAL" : "IN_PROGRESS",
    progress: `${done}/${legs.length}`,
    // Ordered playlist: the console plays these back to back, entrance first.
    legs,
  });
}

async function handleWebhook(
  request: Request,
  env: Env,
  jobId: string,
  index: number,
): Promise<Response> {
  const rawBody = await request.arrayBuffer();

  const verification = await verifyFalWebhook(request, rawBody);
  if (!verification.ok) {
    return json({ error: `rejected: ${verification.reason}` }, 401);
  }

  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  // fal can return status OK with a null or unserialisable payload
  // (documented as payload_error). A leg with no video is not a finished leg,
  // so do not let it report COMPLETED — the console would show a done state
  // with nothing to play.
  const url = body.status === "OK" ? videoUrl(body.payload) : null;
  const state = url
    ? { status: "COMPLETED", video_url: url, request_id: body.request_id }
    : {
        status: "ERROR",
        error: String(
          body.error ?? body.payload_error ?? "render returned no video",
        ),
        request_id: body.request_id,
      };

  await env.SIZEUP_JOBS.put(legKey(jobId, index), JSON.stringify(state), {
    expirationTtl: JOB_TTL_SECONDS,
  });

  // Acknowledge fast; fal retries on anything else.
  return json({ ok: true });
}
