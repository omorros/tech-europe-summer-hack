/** Crew card rows. Same shape as `backend/intelligence/briefing.py`. */

interface Entity {
  type: string;
  value: string;
}

interface Approach {
  coverage?: boolean;
  building_type?: string;
  storeys?: number;
  front_door?: { side?: string; description?: string };
  rear_access?: boolean;
  rear_access_note?: string;
  parking?: string;
}

interface Route {
  waypoints: { room_id: string | null }[];
  entry_point: string;
  rationale: string;
}

interface RoomGraph {
  rooms: { id: string; name: string; floor: number }[];
}

const POSTCODE = /^[a-z]{1,2}\d[a-z\d]?$|^\d[a-z]{2}$/i;
const WORDS_PER_SECOND = 2.6;
const MAX_SECONDS = 30;

function spokenAddress(raw: string): string {
  return raw
    .split(/\s+/)
    .map((word) => (POSTCODE.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

function tidy(name: string): string {
  return name.replace(/[A-Za-z]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function latest(entities: Entity[], type: string): string | undefined {
  for (let i = entities.length - 1; i >= 0; i--) {
    if (entities[i].type === type) return entities[i].value;
  }
}

export function scriptOf(incident: {
  address?: string;
  entities: Entity[];
  approach?: Approach | null;
  route?: Route | null;
  room_graph?: RoomGraph | null;
}): string {
  const { entities, approach, route, room_graph: graph } = incident;
  const lines: [number, string][] = [];
  const address = spokenAddress(incident.address || latest(entities, "ADDRESS") || "address not yet confirmed");

  if (approach?.coverage) {
    lines.push([
      0,
      `Incident at ${address}. ${approach.building_type ?? ""}, ${approach.storeys} storeys.`.replace(/, undefined storeys/, "."),
    ]);
    const door = approach.front_door ?? {};
    if (door.side) lines.push([2, `Front door on the ${door.side}: ${door.description ?? ""}.`]);
    lines.push([
      3,
      approach.rear_access
        ? `Rear access: ${approach.rear_access_note || "available"}.`
        : "No rear access.",
    ]);
    if (approach.parking) lines.push([4, `Parking: ${approach.parking}.`]);
  } else {
    lines.push([0, `Incident at ${address}. No exterior view available.`]);
  }

  if (graph?.rooms.length) {
    const floors = new Map<number, string[]>();
    for (const room of graph.rooms) {
      const list = floors.get(room.floor) ?? [];
      list.push(room.name.toLowerCase());
      floors.set(room.floor, list);
    }
    for (const floor of [...floors.keys()].sort((a, b) => a - b)) {
      const label = floor === 0 ? "Ground floor" : `Floor ${floor}`;
      lines.push([3, `${label}: ${floors.get(floor)!.join(", ")}.`]);
    }
  }

  const fire = latest(entities, "FIRE_ORIGIN");
  if (fire) lines.push([0, `Fire reported in the ${fire}.`]);
  const victim = latest(entities, "VICTIM_LOCATION");
  if (victim) lines.push([0, `Casualty reported: ${victim}.`]);
  if (route) lines.push([1, `Entry plan: ${route.rationale}`]);

  const hazards = entities
    .filter((entity) => entity.type === "HAZARD_TYPE" || entity.type === "EXIT")
    .map((entity) => entity.value);
  if (hazards.length) lines.push([2, `Hazards: ${hazards.join("; ")}.`]);

  let kept = lines;
  for (const drop of [4, 3, 2]) {
    const words = kept.reduce((sum, [, line]) => sum + line.split(/\s+/).length, 0);
    if (words / WORDS_PER_SECOND <= MAX_SECONDS) break;
    kept = kept.filter(([priority]) => priority < drop);
  }
  return kept.map(([, line]) => line).join(" ");
}

export function briefLines(incident: {
  address?: string;
  entities: Entity[];
  approach?: Approach | null;
  route?: Route | null;
  room_graph?: RoomGraph | null;
}): { label: string; value: string; source: string }[] {
  const { entities, approach, route, room_graph: graph } = incident;
  const rows: { label: string; value: string; source: string }[] = [];
  const add = (label: string, value: string | undefined, source: string) => {
    if (value) rows.push({ label, value, source });
  };

  add("ADDRESS", spokenAddress(incident.address || latest(entities, "ADDRESS") || ""), "call");
  if (approach?.coverage) {
    const storeys = approach.storeys ? `, ${approach.storeys} storeys` : "";
    add("BUILDING", `${approach.building_type ?? ""}${storeys}`.replace(/^, /, ""), "street");
    const door = approach.front_door ?? {};
    add(
      "FRONT DOOR",
      door.side ? `${door.side} — ${door.description ?? ""}`.replace(/ —\s*$/, "") : undefined,
      "street",
    );
    add("REAR ACCESS", approach.rear_access ? approach.rear_access_note : "none", "street");
    add("PARKING", approach.parking, "street");
  } else {
    add("BUILDING", "no exterior view available", "plan");
  }
  add("CASUALTY", latest(entities, "VICTIM_LOCATION"), "call");
  add("FIRE", latest(entities, "FIRE_ORIGIN"), "call");
  if (route) {
    const names = new Map((graph?.rooms ?? []).map((room) => [room.id, tidy(room.name)]));
    const path = route.waypoints
      .map((waypoint) => waypoint.room_id && names.get(waypoint.room_id))
      .filter((name): name is string => Boolean(name));
    add("ENTRY", names.get(route.entry_point) ?? route.entry_point, "plan");
    add("ROUTE", path.length ? ["kerb", ...path].join(" → ") : undefined, "plan");
  }
  add(
    "HAZARDS",
    entities
      .filter((entity) => entity.type === "HAZARD_TYPE")
      .map((entity) => entity.value)
      .join("; ") || undefined,
    "call",
  );
  add(
    "AVOID",
    entities
      .filter((entity) => entity.type === "EXIT")
      .map((entity) => entity.value)
      .join("; ") || undefined,
    "call",
  );
  return rows;
}

export function coverageOf(
  graph: RoomGraph & { photo_room_map?: Record<string, string> },
  artifacts: { photos?: { id?: string; url?: string; room_id?: string | null }[] } | null,
  route: Route | null,
  approach: Approach | null,
) {
  if (!graph || !artifacts || !route) return null;
  const photoMap = graph.photo_room_map ?? {};
  const photographed = new Set<string>();
  for (const photo of artifacts.photos ?? []) {
    if (!photo.url) continue;
    const roomId = photo.room_id || photoMap[photo.id ?? ""];
    if (roomId) photographed.add(roomId);
  }
  const rooms = new Map(graph.rooms.map((room) => [room.id, room]));
  const routeRooms: string[] = [];
  for (const waypoint of route.waypoints) {
    if (waypoint.room_id && !routeRooms.includes(waypoint.room_id)) {
      routeRooms.push(waypoint.room_id);
    }
  }
  return {
    route_rooms: routeRooms.length,
    with_imagery: routeRooms.filter((id) => photographed.has(id)).length,
    missing: routeRooms
      .filter((id) => !photographed.has(id))
      .map((id) => rooms.get(id)?.name ?? id),
    opens_on_street_view: Boolean(approach?.coverage),
    photographed_total: photographed.size,
  };
}
