/**
 * Route -> per-leg video prompts.
 *
 * The walkthrough is generated one hop at a time with a first-frame/last-frame
 * model: leg N starts on the real photograph of room N and ends on the real
 * photograph of room N+1. That constraint is the whole point. We are not
 * asking a model to imagine a building — both ends of every leg are
 * photographs that exist, and only the transit between them is synthesised.
 * A crew can therefore be told exactly which frames are evidence and which
 * are inference, which is what makes this defensible in a life-critical
 * setting.
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

function displayName(room: RoomRef): string {
  return (room.name || room.room_id).replace(/_/g, " ");
}

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

  // Kling O1 has no negative_prompt field, so exclusions live in the prompt.
  // Saying the house IS deserted suppresses figures far better than "no
  // people", which names people and tends to summon them — our first real
  // render put a firefighter in the hallway despite that phrasing.
  parts.push(
    "The house is completely deserted: no people, no firefighters, no figures " +
      "or silhouettes anywhere in frame. Nothing moves except the camera. " +
      "Handheld forward motion at walking pace, wide angle, no cuts. " +
      "No text, captions or watermarks. " +
      "Keep the room layout exactly as shown in the two frames.",
  );

  return parts.join(" ");
}

export function buildLegs(request: WalkthroughRequest): Leg[] {
  const route = request.route ?? [];
  if (route.length < 2) {
    throw new Error("route needs at least two rooms: the entrance and the ignition point");
  }

  const seconds = String(
    Math.min(10, Math.max(3, Math.round(request.seconds_per_leg ?? DEFAULT_SECONDS))),
  );

  const photoFor = (room: RoomRef): string | undefined =>
    request.photos?.[room.room_id] ?? room.photo_url;

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
