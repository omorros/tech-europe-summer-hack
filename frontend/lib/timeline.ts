import type { BusEvent, Room } from "./types";

/**
 * The scripted demo. Synthetic data throughout — no real 999 call, no real
 * property, no real Street View. Every surface that shows it stamps it SYNTHETIC.
 * Replace each payload with the real lane event; the shapes already match.
 */

export const DEMO_ADDRESS = "41 Ashcombe Road, Sheffield S11 8YQ";

const CALL_ID = "999-0417";

interface Beat {
  /** ms after the run starts */
  at: number;
  event: BusEvent;
}

const t = (at: number, event: Omit<BusEvent, "ts">): Beat =>
  ({ at, event: { ...event, ts: at } as BusEvent });

/** Ground floor left, first floor right. Floor-plan pixels, origin top-left. */
export const DEMO_ROOMS: Room[] = [
  {
    id: "living",
    name: "Living room",
    floor: 0,
    polygon: [[40, 120], [180, 120], [180, 300], [40, 300]],
    doors: [[180, 220]],
    windows: [[40, 200]],
  },
  {
    id: "hall",
    name: "Hall",
    floor: 0,
    polygon: [[180, 120], [260, 120], [260, 420], [180, 420]],
    doors: [[220, 420], [260, 200]],
    windows: [],
  },
  {
    id: "dining",
    name: "Dining",
    floor: 0,
    polygon: [[260, 120], [470, 120], [470, 260], [260, 260]],
    doors: [[300, 260]],
    windows: [[380, 120]],
  },
  {
    id: "kitchen",
    name: "Kitchen",
    floor: 0,
    polygon: [[260, 260], [470, 260], [470, 420], [260, 420]],
    doors: [[470, 340]],
    windows: [[380, 420]],
  },
  {
    id: "landing",
    name: "Landing",
    floor: 1,
    polygon: [[670, 120], [750, 120], [750, 420], [670, 420]],
    doors: [[750, 200], [750, 340]],
    windows: [],
  },
  {
    id: "front_bed",
    name: "Front bedroom",
    floor: 1,
    polygon: [[530, 120], [670, 120], [670, 300], [530, 300]],
    doors: [[670, 220]],
    windows: [[530, 200]],
  },
  {
    id: "bathroom",
    name: "Bathroom",
    floor: 1,
    polygon: [[750, 120], [960, 120], [960, 260], [750, 260]],
    doors: [[790, 260]],
    windows: [[860, 120]],
  },
  {
    id: "back_bed",
    name: "Back bedroom",
    floor: 1,
    polygon: [[750, 260], [960, 260], [960, 420], [750, 420]],
    doors: [[750, 340]],
    windows: [[860, 420]],
  },
];

export function buildTimeline(): Beat[] {
  return [
    t(0, { type: "status", payload: { stage: "call", state: "running", message: "Line open" } }),
    t(200, { type: "call.incoming", payload: { call_id: CALL_ID } }),
    t(2400, { type: "call.answered", payload: { call_id: CALL_ID } }),

    t(2600, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 1, text: "Fire service, what is the address of the emergency?", is_final: true, speaker: "operator" },
    }),
    t(4200, { type: "status", payload: { stage: "extract", state: "running", message: "Extractor live" } }),
    t(4400, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 2, text: "It's forty one Ashcombe", is_final: false, speaker: "caller" },
    }),
    t(5100, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 2, text: "It's forty one Ashcombe Road, Sheffield, S11 8YQ", is_final: true, speaker: "caller" },
    }),
    t(5400, {
      type: "entity.extracted",
      payload: { type: "ADDRESS", value: DEMO_ADDRESS, confidence: 0.96, source: "call", ts: 5400 },
    }),
    t(5500, { type: "status", payload: { stage: "approach", state: "running", message: "Geocoding" } }),
    t(5600, { type: "status", payload: { stage: "agent", state: "running", message: "Opening Rightmove sold prices" } }),

    t(6200, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 3, text: "The kitchen's on fire, there's smoke", is_final: false, speaker: "caller" },
    }),
    t(6900, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 3, text: "The kitchen's on fire, there's smoke everywhere down here", is_final: true, speaker: "caller" },
    }),
    t(7100, {
      type: "entity.extracted",
      payload: { type: "FIRE_ORIGIN", value: "Kitchen, ground floor", confidence: 0.93, source: "call", ts: 7100 },
    }),

    t(7600, {
      type: "agent.step",
      payload: { step: 1, action: "navigate", thought: "Rightmove sold prices, postcode S11 8YQ", screenshot_url: "" },
    }),

    t(8400, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 4, text: "My mum's upstairs, she's in the back bedroom, she can't get down", is_final: true, speaker: "caller" },
    }),
    t(8700, {
      type: "entity.extracted",
      payload: { type: "VICTIM_LOCATION", value: "Back bedroom, first floor", confidence: 0.91, source: "call", ts: 8700 },
    }),

    t(9200, {
      type: "approach.ready",
      payload: {
        lat: 53.3536,
        lng: -1.5021,
        streetview: [
          { heading: 15, url: "" },
          { heading: 105, url: "" },
          { heading: 285, url: "" },
        ],
        satellite_url: "",
        building_type: "Mid-terrace, brick, pitched slate roof",
        storeys: 2,
        front_door: { side: "Left of the bay, set back one step", description: "Timber door, single leaf, opens inward" },
        access_notes: [
          "Street parking both sides — appliance can stand outside no. 39",
          "No gate, no steps to the threshold",
          "Hydrant marker on the kerb opposite no. 44",
        ],
        obstacles: ["Wheelie bins stored in the side passage", "Parked cars narrow the road to one lane"],
        rear_access: true,
        rear_access_note: "Rear yard reachable only through the shared side passage",
        parking: "Kerbside, outside no. 39",
        coverage: true,
      },
    }),
    t(9300, { type: "status", payload: { stage: "approach", state: "done", message: "Read from 3 headings" } }),

    t(9800, {
      type: "agent.step",
      payload: { step: 2, action: "click", thought: "Matched 41 Ashcombe Road, sold Mar 2019", screenshot_url: "" },
    }),
    t(10600, {
      type: "transcript.fragment",
      payload: { call_id: CALL_ID, seq: 5, text: "We can't get out the back, the bins are against the door", is_final: true, speaker: "caller" },
    }),
    t(10900, {
      type: "entity.extracted",
      payload: { type: "EXIT", value: "Rear exit blocked — bins against the door", confidence: 0.88, source: "call", ts: 10900 },
    }),
    t(11400, {
      type: "entity.extracted",
      payload: { type: "HAZARD_TYPE", value: "Smoke logging, ground floor and stairs", confidence: 0.84, source: "call", ts: 11400 },
    }),

    t(11800, {
      type: "agent.step",
      payload: { step: 3, action: "scroll", thought: "Gallery open — 14 interior photos", screenshot_url: "" },
    }),
    t(12600, {
      type: "agent.step",
      payload: { step: 4, action: "click", thought: "Floor plan tab", screenshot_url: "" },
    }),
    t(13400, {
      type: "agent.step",
      payload: { step: 5, action: "extract", thought: "Floor plan and 14 photos captured", screenshot_url: "" },
    }),
    t(13600, {
      type: "agent.artifacts",
      payload: {
        address: DEMO_ADDRESS,
        listing_url: "rightmove.co.uk/house-prices/…/ashcombe-road",
        floorplan_url: "",
        photos: [
          { id: "p1", url: "", caption: "Kitchen, rear aspect", room_id: "kitchen" },
          { id: "p2", url: "", caption: "Hall and staircase", room_id: "hall" },
          { id: "p3", url: "", caption: "Rear bedroom", room_id: "back_bed" },
          { id: "p4", url: "", caption: "Living room, bay window", room_id: "living" },
          { id: "p5", url: "", caption: "Bathroom", room_id: "bathroom" },
        ],
      },
    }),
    t(13700, { type: "status", payload: { stage: "agent", state: "done", message: "Listing captured" } }),
    t(13800, { type: "status", payload: { stage: "rooms", state: "running", message: "Reading floor plan" } }),
    t(14000, { type: "call.ended", payload: { call_id: CALL_ID } }),
    t(14100, { type: "status", payload: { stage: "call", state: "done", message: "Caller hung up" } }),
    t(14200, { type: "status", payload: { stage: "extract", state: "done", message: "5 entities" } }),

    t(15200, {
      type: "rooms.graph",
      payload: {
        rooms: DEMO_ROOMS,
        adjacency: [
          ["hall", "living"], ["hall", "dining"], ["dining", "kitchen"],
          ["hall", "landing"], ["landing", "front_bed"], ["landing", "back_bed"], ["landing", "bathroom"],
        ],
        entry_points: ["hall"],
        photo_room_map: { p1: "kitchen", p2: "hall", p3: "back_bed", p4: "living", p5: "bathroom" },
      },
    }),
    t(15300, { type: "status", payload: { stage: "rooms", state: "done", message: "8 rooms, 2 floors" } }),
    t(15400, { type: "status", payload: { stage: "scene", state: "running", message: "Reconstructing back bedroom" } }),
    t(15500, { type: "status", payload: { stage: "route", state: "running", message: "Planning from kerb" } }),

    t(16800, {
      type: "route.planned",
      payload: {
        entry_point: "hall",
        rationale:
          "Front door: rear is blocked by bins and reachable only through the side passage. Straight up the stairs before the kitchen vents into the hall.",
        waypoints: [
          { room_id: "hall", x: 220, y: 445 },
          { room_id: "hall", x: 220, y: 300 },
          { room_id: "hall", x: 220, y: 170 },
          { room_id: "landing", x: 710, y: 380 },
          { room_id: "landing", x: 710, y: 320 },
          { room_id: "back_bed", x: 855, y: 340 },
        ],
      },
    }),
    t(16900, { type: "status", payload: { stage: "route", state: "done", message: "Front door, 5 waypoints" } }),

    t(18000, {
      type: "scene.ready",
      payload: {
        room_id: "back_bed",
        viewer_url: "",
        thumbnail_url: "",
        pins: [
          { entity_type: "VICTIM_LOCATION", x: 855, y: 340 },
          { entity_type: "EXIT", x: 860, y: 420 },
        ],
      },
    }),
    t(18100, { type: "status", payload: { stage: "scene", state: "done", message: "Back bedroom explorable" } }),
    t(18200, { type: "status", payload: { stage: "briefing", state: "running", message: "Rendering 30s brief" } }),

    t(21000, {
      type: "briefing.ready",
      payload: {
        video_url: "",
        captions_url: "",
        duration_s: 30,
        script:
          "Mid-terrace, two storeys, 41 Ashcombe Road. Front door left of the bay, one step, opens inward. Stand the appliance outside 39. Fire is in the kitchen at the rear of the ground floor and the hall is smoke logged. Casualty is in the back bedroom, first floor, rear right. Rear exit is blocked by bins — go in the front and straight up.",
      },
    }),
    t(21100, { type: "status", payload: { stage: "briefing", state: "done", message: "30s brief ready" } }),
  ];
}

