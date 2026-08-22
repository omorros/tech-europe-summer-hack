/**
 * Mirrors backend/shared/types.py exactly. Locked interface — changing anything
 * here means telling Oriol and Bill in the same minute.
 */

export type EntityType =
  | "ADDRESS"
  | "FIRE_ORIGIN"
  | "VICTIM_LOCATION"
  | "HAZARD_TYPE"
  | "EXIT";

export type Stage =
  | "call"
  | "extract"
  | "approach"
  | "agent"
  | "rooms"
  | "scene"
  | "route"
  | "briefing";

export type StageState = "pending" | "running" | "done" | "error";

export interface Entity {
  type: EntityType;
  value: string;
  confidence: number;
  source: "call" | "radio";
  ts: number;
}

export interface Photo {
  id: string;
  url: string;
  caption: string;
  room_id: string | null;
}

export interface Artifacts {
  address: string;
  listing_url: string;
  floorplan_url: string;
  photos: Photo[];
}

export interface Approach {
  lat: number;
  lng: number;
  streetview: { heading: number; url: string }[];
  satellite_url: string;
  building_type: string;
  storeys: number;
  front_door: { side: string; description: string };
  access_notes: string[];
  obstacles: string[];
  rear_access: boolean;
  rear_access_note: string;
  parking: string;
  coverage: boolean;
}

export interface Room {
  id: string;
  name: string;
  floor: number;
  /** Floor-plan pixel coordinates, origin top-left. */
  polygon: [number, number][];
  doors: [number, number][];
  windows: [number, number][];
}

export interface RoomGraph {
  rooms: Room[];
  adjacency: [string, string][];
  entry_points: string[];
  photo_room_map: Record<string, string>;
  floorplan_width?: number;
  floorplan_height?: number;
}

export interface Scene {
  room_id: string;
  viewer_url: string;
  thumbnail_url: string;
  pins: { entity_type: EntityType; x: number; y: number }[];
}

export interface Route {
  waypoints: { room_id: string | null; x: number; y: number }[];
  entry_point: string;
  rationale: string;
}

export interface BriefingLine {
  label: string;
  value: string;
  source: "call" | "street" | "listing" | "plan";
}

export interface WalkthroughCoverage {
  route_rooms: number;
  with_imagery: number;
  missing: string[];
  opens_on_street_view?: boolean;
  extra_rooms_shown?: string[];
  photographed_total?: number;
}

export interface WalkthroughLeg {
  index: number;
  label?: string;
  narration?: string;
  status?: string;
  video_url?: string | null;
}

export interface Briefing {
  video_url: string;
  captions_url: string;
  duration_s: number;
  script: string;
  lines?: BriefingLine[];
  coverage?: WalkthroughCoverage;
  legs?: WalkthroughLeg[];
}

export type BusEvent =
  | { type: "call.incoming"; ts: number; payload: { call_id: string } }
  | { type: "call.answered"; ts: number; payload: { call_id: string } }
  | { type: "call.ended"; ts: number; payload: { call_id: string } }
  | {
      type: "transcript.fragment";
      ts: number;
      payload: {
        call_id: string;
        seq: number;
        text: string;
        is_final: boolean;
        speaker: "caller" | "operator";
      };
    }
  | { type: "entity.extracted"; ts: number; payload: Entity }
  | { type: "approach.ready"; ts: number; payload: Approach }
  | {
      type: "agent.step";
      ts: number;
      payload: {
        step: number;
        action: string;
        thought: string;
        screenshot_url: string;
      };
    }
  | { type: "agent.artifacts"; ts: number; payload: Artifacts }
  | { type: "rooms.graph"; ts: number; payload: RoomGraph }
  | { type: "scene.ready"; ts: number; payload: Scene }
  | { type: "route.planned"; ts: number; payload: Route }
  | { type: "briefing.ready"; ts: number; payload: Briefing }
  | {
      type: "status";
      ts: number;
      payload: { stage: Stage; state: StageState; message: string };
    }
  | { type: "radio.update"; ts: number; payload: { text: string } };

export type BusEventType = BusEvent["type"];

export const STAGES: { id: Stage; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "extract", label: "Extract" },
  { id: "approach", label: "Approach" },
  { id: "agent", label: "Agent" },
  { id: "rooms", label: "Rooms" },
  { id: "scene", label: "Scene" },
  { id: "route", label: "Route" },
  { id: "briefing", label: "Briefing" },
];
