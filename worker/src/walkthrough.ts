/**
 * Route -> per-leg video prompts.
 *
 * Two shapes, both first-frame/last-frame:
 *
 *   continuous (default for the console) — one clip, the real photograph of
 *   the entrance to the real photograph of the room the fire started in, with
 *   the rooms in between named in the prompt. A crew watches one unbroken
 *   approach rather than a playlist that cuts at every doorway. Kling caps a
 *   generation at 10s, so that is the length of the walk.
 *
 *   per hop — leg N starts on the photograph of room N and ends on the
 *   photograph of room N+1, so every room on the route is evidence rather
 *   than inference. Longer and more faithful, but it cuts.
 *
 * Either way both ends of a generated clip are photographs that exist and
 * only the transit between them is synthesised, so a crew can be told exactly
 * which frames are evidence and which are inference. That is what makes this
 * defensible in a life-critical setting.
 *
 * Evidence for building it as a route rather than a floor plan: firefighters
 * given explicit route information outperform those given a survey/plan,
 * because they do not have to plan a route from a complicated drawing under
 * stress (Safety Science 2021; replicated 2023). Knowing where to go cut
 * search time 34% in a 2025 Fire study.
 */

export interface RoomRef {
  room_id: string;
  name?: string;
  floor?: number;
  photo_url?: string;
  caption?: string;
}

export interface WalkthroughRequest {
  address?: string;
  /** Free text: "mid-terrace, two storeys, front door on the left". */
  building_description?: string;
  /** Free text: "ground floor hallway to lounge, kitchen at the rear". */
  floorplan_description?: string;
  /** Ordered rooms, entrance first, ignition point last. */
  route: RoomRef[];
  /** photo per room; overrides route[].photo_url. Accepts URLs or data URIs. */
  photos?: Record<string, string>;
  /** e.g. ["heavy smoke on the staircase"] — narrated, not invented visually. */
  hazards?: string[];
  /** Seconds per leg, 3-10 (Kling O1 allows this range). */
  seconds_per_leg?: number;
  /** Prompts authored upstream by a model that has seen the floor plan.
   *  Indexed by leg; anything missing falls back to the template below. */
  leg_prompts?: string[];
  /** One unbroken take from the entrance to the seat of the fire instead of a
   *  clip per hop. The rooms between the two ends are named in the prompt
   *  rather than photographed, so only the first and last need an image. */
  continuous?: boolean;
}

export interface Leg {
  index: number;
  from: string;
  to: string;
  from_room_id: string;
  to_room_id: string;
  label: string;
  prompt: string;
  start_image_url: string;
  end_image_url?: string;
  duration: string;
  /** Filled in as the job progresses. */
  request_id?: string;
  /** Returned by fal on submit — authoritative, do not reconstruct. */
  status_url?: string;
  response_url?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "ERROR";
  video_url?: string;
  error?: string;
}

const DEFAULT_SECONDS = 5;
/** Longest single clip Kling O1 will render. A continuous walk takes all of it. */
const MAX_SECONDS = 10;

function displayName(room: RoomRef): string {
  return (room.name || room.room_id).replace(/_/g, " ");
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and the ${names[names.length - 1]}`;
}

// Kling O1 has no negative_prompt field, so exclusions live in the prompt.
// Saying the house IS deserted suppresses figures far better than "no
// people", which names people and tends to summon them — our first real
// render put a firefighter in the hallway despite that phrasing.
const DESERTED =
  "The house is completely deserted: no people, no firefighters, no figures " +
  "or silhouettes anywhere in frame. Nothing moves except the camera. " +
  "Handheld forward motion at walking pace, wide angle, no cuts. " +
  "No text, captions or watermarks.";

/**
 * Helmet-cam framing, deliberately conservative: forward motion between two
 * real photographs, no invented doors, no people, no fire theatrics that
 * would mislead a crew about what they are walking into.
 */
export function legPrompt(
  from: RoomRef,
  to: RoomRef,
  request: WalkthroughRequest,
  isFinal: boolean,
): string {
  const a = displayName(from);
  const b = displayName(to);
  const parts: string[] = [];

  parts.push(
    `Firefighter helmet-camera point of view walking forward through a house. ` +
      `Start on @Image1, the ${a}. Move steadily forward and end on @Image2, the ${b}.`,
  );

  if (from.floor !== undefined && to.floor !== undefined && to.floor > from.floor) {
    parts.push("The camera climbs a staircase between the two rooms.");
  } else if (from.floor !== undefined && to.floor !== undefined && to.floor < from.floor) {
    parts.push("The camera descends a staircase between the two rooms.");
  }

  if (isFinal) {
    parts.push(
      `The ${b} is the seat of the fire: end the shot facing into it, with ` +
        `thickening smoke and firelight ahead.`,
    );
  } else {
    parts.push("Thin smoke haze, low light, torch beam lighting the way ahead.");
  }

  if (request.building_description) {
    parts.push(`The building is a ${request.building_description}.`);
  }

  parts.push(`${DESERTED} Keep the room layout exactly as shown in the two frames.`);

  return parts.join(" ");
}

/**
 * One prompt for the whole journey, entrance to seat of fire.
 *
 * Only the two ends are photographs here, so the rooms in between have to be
 * named rather than shown. That is the trade for an unbroken take: a crew sees
 * one continuous approach instead of a playlist that cuts at every doorway,
 * and the order of the rooms still comes off the floor plan.
 */
export function continuousPrompt(request: WalkthroughRequest): string {
  const route = request.route ?? [];
  const first = route[0];
  const last = route[route.length - 1];
  const between = route.slice(1, -1).map(displayName);
  const parts: string[] = [];

  parts.push(
    `Firefighter helmet-camera point of view: one unbroken walk through a ` +
      `house, from the entrance to the seat of the fire. Begin on @Image1, ` +
      `the ${displayName(first)}, and finish on @Image2, the ${displayName(last)}.`,
  );

  parts.push(
    between.length
      ? `Move through the building in a single continuous take, passing the ` +
        `${listOf(between)} on the way. Do not cut.`
      : "Move through the building in a single continuous take. Do not cut.",
  );

  const floors = route
    .map((room) => room.floor)
    .filter((floor): floor is number => floor !== undefined);
  if (floors.length > 1) {
    const top = Math.max(...floors);
    const bottom = Math.min(...floors);
    if (top > bottom) {
      parts.push("The camera climbs a staircase partway through the walk.");
    }
  }

  parts.push(
    `Smoke thickens as the camera moves deeper into the house: clear air at ` +
      `the entrance, thin haze in the middle of the walk, and heavy smoke with ` +
      `firelight ahead as it reaches the ${displayName(last)}, where the fire is.`,
  );

  if (request.building_description) {
    parts.push(`The building is a ${request.building_description}.`);
  }

  parts.push(
    `${DESERTED} Keep the layout of the two photographed rooms exactly as shown.`,
  );

  return parts.join(" ");
}

function photoOf(request: WalkthroughRequest, room: RoomRef): string | undefined {
  return request.photos?.[room.room_id] ?? room.photo_url;
}

/**
 * The whole route as a single clip. Kling caps a generation at 10s, so an
 * unbroken walk is 10s of walk — there is no way to buy more without cutting,
 * and cutting is exactly what this mode exists to avoid.
 */
function buildContinuousLeg(request: WalkthroughRequest): Leg {
  const route = request.route ?? [];
  const first = route[0];
  const last = route[route.length - 1];
  const start = photoOf(request, first);
  if (!start) {
    throw new Error(
      `no photo for "${first.room_id}" — a continuous walk needs an image to start from`,
    );
  }
  const seconds = String(
    Math.min(MAX_SECONDS, Math.max(3, Math.round(request.seconds_per_leg ?? MAX_SECONDS))),
  );
  return {
    index: 0,
    from: displayName(first),
    to: displayName(last),
    from_room_id: first.room_id,
    to_room_id: last.room_id,
    label: `${displayName(first)} → ${displayName(last)}`,
    prompt: request.leg_prompts?.[0] || continuousPrompt(request),
    start_image_url: start,
    end_image_url: photoOf(request, last),
    duration: seconds,
    status: "IN_QUEUE",
  };
}

export function buildLegs(request: WalkthroughRequest): Leg[] {
  const route = request.route ?? [];
  if (route.length < 2) {
    throw new Error("route needs at least two rooms: the entrance and the ignition point");
  }

  if (request.continuous) return [buildContinuousLeg(request)];

  const seconds = String(
    Math.min(MAX_SECONDS, Math.max(3, Math.round(request.seconds_per_leg ?? DEFAULT_SECONDS))),
  );

  const photoFor = (room: RoomRef): string | undefined => photoOf(request, room);

  const legs: Leg[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];
    const start = photoFor(from);
    if (!start) {
      throw new Error(
        `no photo for "${from.room_id}" — every room on the route except the last needs one`,
      );
    }
    const isFinal = i === route.length - 2;
    const authored = request.leg_prompts?.[i];
    legs.push({
      index: i,
      from: displayName(from),
      to: displayName(to),
      from_room_id: from.room_id,
      to_room_id: to.room_id,
      label: `${displayName(from)} → ${displayName(to)}`,
      prompt: authored || legPrompt(from, to, request, isFinal),
      start_image_url: start,
      end_image_url: photoFor(to),
      duration: seconds,
      status: "IN_QUEUE",
    });
  }
  return legs;
}

/**
 * The spoken line for each leg. The crew hears where they are going while the
 * clip plays; hazards are narrated rather than depicted, because a model
 * inventing flames in the wrong room is worse than no video at all.
 */
export function legNarration(leg: Leg, request: WalkthroughRequest): string {
  if (request.continuous) {
    const between = (request.route ?? []).slice(1, -1).map(displayName);
    const path = between.length ? ` through the ${listOf(between)},` : "";
    const hazards = request.hazards ?? [];
    const line = `Entry via the ${leg.from},${path} to the ${leg.to}, where the fire is.`;
    return hazards.length ? `${line} ${hazards.join("; ")}.` : line;
  }

  const hazards = (request.hazards ?? []).filter((h) =>
    h.toLowerCase().includes(leg.to_room_id.replace(/_/g, " ")) ||
    h.toLowerCase().includes(leg.to.toLowerCase()),
  );
  const base =
    leg.index === 0
      ? `Entry via the ${leg.from}. Then ${leg.to}.`
      : `${leg.from} through to the ${leg.to}.`;
  if (!hazards.length) return base;
  const warning = hazards.join("; ");
  return `${base} ${warning.charAt(0).toUpperCase()}${warning.slice(1)}.`;
}
