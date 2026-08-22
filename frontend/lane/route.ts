/** Kerb → entry → casualty. Same rules as `backend/intelligence/route.py`. */

interface Room {
  id: string;
  name: string;
  floor: number;
  polygon: number[][];
  doors: number[][];
}

export interface RoomGraph {
  rooms: Room[];
  adjacency: [string, string][];
  entry_points: string[];
  photo_room_map?: Record<string, string>;
  floorplan_width?: number;
  floorplan_height?: number;
}

export interface Approach {
  coverage?: boolean;
  rear_access?: boolean;
  rear_access_note?: string;
}

export interface Entity {
  type: string;
  value: string;
}

const ALIASES: Record<string, string> = {
  "living room": "lounge",
  "sitting room": "lounge",
  "front room": "lounge",
  hall: "hallway",
  corridor: "hallway",
  loo: "bathroom",
  toilet: "bathroom",
  wc: "bathroom",
  stairs: "landing",
  staircase: "landing",
  cooker: "kitchen",
  oven: "kitchen",
  stove: "kitchen",
  hob: "kitchen",
};

const BLOCKED = ["blocked", "locked", "jammed", "impassable", "on fire"];

function tokens(phrase: string): Set<string> {
  let text = phrase.toLowerCase();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    text = text.replaceAll(alias, canonical);
  }
  return new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
}

export function matchRoom(graph: RoomGraph, phrase: string): string | null {
  const words = tokens(phrase);
  let bestId: string | null = null;
  let best = 0;
  for (const room of graph.rooms) {
    const nameWords = new Set([...tokens(room.name), ...tokens(room.id)]);
    let score = 0;
    for (const word of words) if (nameWords.has(word)) score += 2;
    if (words.has("upstairs") && room.floor >= 1) score += 1;
    if (words.has("downstairs") && room.floor === 0) score += 1;
    if (score > best) {
      best = score;
      bestId = room.id;
    }
  }
  return bestId;
}

function centroid(polygon: number[][]): [number, number] {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return [
    Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length),
    Math.floor(ys.reduce((a, b) => a + b, 0) / ys.length),
  ];
}

function neighbours(graph: RoomGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const room of graph.rooms) adj.set(room.id, new Set());
  for (const [a, b] of graph.adjacency) {
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  return adj;
}

function bfs(
  graph: RoomGraph,
  start: string,
  goal: string,
  avoid: Set<string>,
): string[] | null {
  const adj = neighbours(graph);
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const node = path[path.length - 1];
    if (node === goal) return path;
    for (const next of adj.get(node) ?? []) {
      if (seen.has(next) || (avoid.has(next) && next !== goal)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

function classify(graph: RoomGraph, entryId: string): "front" | "rear" {
  const room = graph.rooms.find((item) => item.id === entryId);
  const words = new Set([...tokens(entryId), ...tokens(room?.name ?? "")]);
  for (const word of ["kitchen", "utility", "rear", "back", "garage", "conservatory"]) {
    if (words.has(word)) return "rear";
  }
  return "front";
}

function blockedSides(exits: Entity[]): Set<string> {
  const sides = new Set<string>();
  for (const entity of exits) {
    const value = entity.value.toLowerCase();
    if (!BLOCKED.some((word) => value.includes(word))) continue;
    if (["back", "rear", "patio", "french"].some((word) => value.includes(word))) {
      sides.add("rear");
    }
    if (["front", "escape"].some((word) => value.includes(word))) sides.add("front");
  }
  return sides;
}

function planSize(graph: RoomGraph): [number, number] {
  const width =
    graph.floorplan_width ??
    Math.max(...graph.rooms.flatMap((room) => room.polygon.map((p) => p[0])));
  const height =
    graph.floorplan_height ??
    Math.max(...graph.rooms.flatMap((room) => room.polygon.map((p) => p[1])));
  return [width, height];
}

function kerb(graph: RoomGraph, entry: Room): { room_id: null; x: number; y: number } {
  const [width, height] = planSize(graph);
  const doors = entry.doors.length ? entry.doors : [centroid(entry.polygon)];
  let best = doors[0];
  let bestDist = 1e12;
  for (const [x, y] of doors) {
    const dist = Math.min(x, y, width - x, height - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = [x, y];
    }
  }
  const [x, y] = best;
  const candidates: [number, [number, number]][] = [
    [height - y, [x, height - 2]],
    [x, [2, y]],
    [width - x, [width - 2, y]],
    [y, [x, 2]],
  ];
  candidates.sort((a, b) => a[0] - b[0]);
  const [kx, ky] = candidates[0][1];
  return { room_id: null, x: Math.floor(kx), y: Math.floor(ky) };
}

function chooseEntry(
  graph: RoomGraph,
  fireRooms: Set<string>,
  blocked: Set<string>,
  approach: Approach | null,
): [string, string] {
  const candidates = graph.entry_points.length
    ? graph.entry_points
    : [graph.rooms[0].id];
  let usable = candidates.filter(
    (id) => !fireRooms.has(id) && !blocked.has(classify(graph, id)),
  );
  if (!usable.length) {
    usable = candidates.filter((id) => !fireRooms.has(id));
    if (!usable.length) usable = candidates;
  }
  const front = usable.filter((id) => classify(graph, id) === "front");
  const rear = usable.filter((id) => classify(graph, id) === "rear");
  const noExterior = !approach?.coverage;
  const fireAtFront = [...fireRooms].some(
    (id) => candidates.includes(id) && classify(graph, id) === "front",
  );
  if (noExterior) return [front[0] ?? usable[0], "no exterior view — assuming a front-door approach"];
  if (fireAtFront && rear.length && approach?.rear_access) {
    return [
      rear[0],
      `fire is at the front — going in from the rear (${approach.rear_access_note || "rear access available"})`,
    ];
  }
  if (front.length) {
    let why = "front door clear";
    if (fireRooms.size) why += "; fire is away from the entry";
    return [front[0], why];
  }
  return [usable[0], "front access unusable — entering from the rear"];
}

export function planRoute(
  graph: RoomGraph,
  victim: Entity | null,
  hazards: Entity[],
  approach: Approach | null,
) {
  const byId = new Map(graph.rooms.map((room) => [room.id, room]));
  const fireRooms = new Set(
    hazards
      .filter((entity) => entity.type === "FIRE_ORIGIN")
      .map((entity) => matchRoom(graph, entity.value))
      .filter((id): id is string => Boolean(id)),
  );
  const softAvoid = new Set(
    hazards
      .filter((entity) => entity.type === "HAZARD_TYPE")
      .map((entity) => matchRoom(graph, entity.value))
      .filter((id): id is string => Boolean(id)),
  );
  const blocked = blockedSides(hazards.filter((entity) => entity.type === "EXIT"));

  let victimRoom = victim ? matchRoom(graph, victim.value) : null;
  if (!victimRoom) {
    const bedrooms = graph.rooms
      .filter((room) => /bed/i.test(room.id) || /bed/i.test(room.name))
      .map((room) => room.id);
    victimRoom = bedrooms[0] ?? graph.rooms[graph.rooms.length - 1].id;
  }

  const [entry, entryWhy] = chooseEntry(graph, fireRooms, blocked, approach);
  const notes: string[] = [];
  let path = bfs(graph, entry, victimRoom, new Set([...fireRooms, ...softAvoid]));
  if (!path) {
    path = bfs(graph, entry, victimRoom, fireRooms);
    if (path && softAvoid.size) {
      const names = [...softAvoid]
        .filter((id) => path!.includes(id))
        .map((id) => byId.get(id)?.name.toLowerCase() ?? id)
        .join(", ");
      if (names) notes.push(`route passes reported hazards (${names}) — no clear alternative`);
    }
  }
  if (!path) {
    path = bfs(graph, entry, victimRoom, new Set());
    notes.push("no fire-free path — crossing the fire room, crew to confirm");
  }
  if (!path) path = [entry, victimRoom];

  const waypoints: { room_id: string | null; x: number; y: number }[] = [
    kerb(graph, byId.get(entry)!),
  ];
  for (const roomId of path) {
    const [x, y] = centroid(byId.get(roomId)!.polygon);
    waypoints.push({ room_id: roomId, x, y });
  }
  for (const side of [...blocked].sort()) notes.push(`${side} exit reported blocked`);

  const target = byId.get(victimRoom)?.name.toLowerCase() ?? victimRoom;
  let rationale = `Enter via the ${byId.get(entry)?.name.toLowerCase()} (${entryWhy}); make for the ${target}.`;
  if (notes.length) rationale += ` ${notes.join("; ")}.`;

  return { waypoints, entry_point: entry, rationale };
}
