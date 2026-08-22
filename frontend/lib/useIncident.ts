"use client";

import { useCallback, useMemo, useReducer } from "react";
import type {
  Approach,
  Artifacts,
  Briefing,
  BusEvent,
  Entity,
  Route,
  RoomGraph,
  Scene,
  Stage,
  StageState,
} from "./types";
import { STAGES } from "./types";

export type CallState = "idle" | "incoming" | "answered" | "ended";

export interface LogLine {
  /** Print order in the roll. Never reused, never reordered. */
  no: number;
  ts: number;
  kind: "transcript" | "system" | "agent" | "radio";
  speaker?: "caller" | "operator";
  seq?: number;
  text: string;
  isFinal: boolean;
  /** Entities stamped into this line, where they were said. */
  entities: Entity[];
  step?: number;
  action?: string;
}

export interface IncidentState {
  callState: CallState;
  callId: string | null;
  lines: LogLine[];
  nextNo: number;
  entities: Entity[];
  approach: Approach | null;
  artifacts: Artifacts | null;
  graph: RoomGraph | null;
  scene: Scene | null;
  route: Route | null;
  briefing: Briefing | null;
  agentSteps: { step: number; action: string; thought: string }[];
  stages: Record<Stage, { state: StageState; message: string }>;
}

const initialStages = () =>
  Object.fromEntries(
    STAGES.map(({ id }) => [id, { state: "pending" as StageState, message: "" }]),
  ) as IncidentState["stages"];

export const emptyIncident = (): IncidentState => ({
  callState: "idle",
  callId: null,
  lines: [],
  nextNo: 1,
  entities: [],
  approach: null,
  artifacts: null,
  graph: null,
  scene: null,
  route: null,
  briefing: null,
  agentSteps: [],
  stages: initialStages(),
});

function print(
  state: IncidentState,
  line: Omit<LogLine, "no" | "entities" | "isFinal"> & Partial<Pick<LogLine, "isFinal" | "entities">>,
): IncidentState {
  return {
    ...state,
    nextNo: state.nextNo + 1,
    lines: [
      ...state.lines,
      { no: state.nextNo, isFinal: true, entities: [], ...line } as LogLine,
    ],
  };
}

function reduce(state: IncidentState, event: BusEvent): IncidentState {
  switch (event.type) {
    case "call.incoming":
      return print(
        { ...state, callState: "incoming", callId: event.payload.call_id },
        { ts: event.ts, kind: "system", text: `Incoming 999 — call ${event.payload.call_id}` },
      );

    case "call.answered":
      return print(
        { ...state, callState: "answered" },
        { ts: event.ts, kind: "system", text: "Call answered by operator" },
      );

    case "call.ended":
      return print(
        { ...state, callState: "ended" },
        { ts: event.ts, kind: "system", text: "Caller hung up" },
      );

    case "transcript.fragment": {
      const { seq, text, is_final, speaker } = event.payload;
      const existing = state.lines.findIndex(
        (line) => line.kind === "transcript" && line.seq === seq,
      );
      if (existing >= 0) {
        const lines = [...state.lines];
        lines[existing] = { ...lines[existing], text, isFinal: is_final };
        return { ...state, lines };
      }
      return print(state, {
        ts: event.ts,
        kind: "transcript",
        seq,
        speaker,
        text,
        isFinal: is_final,
      });
    }

    case "entity.extracted": {
      const entity = event.payload;
      const entities = [...state.entities, entity];
      // Stamp it into the line it was said in: the last final caller fragment.
      const target = [...state.lines]
        .reverse()
        .find((line) => line.kind === "transcript" && line.speaker === "caller");
      if (target && entity.source === "call") {
        const lines = state.lines.map((line) =>
          line.no === target.no ? { ...line, entities: [...line.entities, entity] } : line,
        );
        return { ...state, entities, lines };
      }
      return print({ ...state, entities }, {
        ts: event.ts,
        kind: "radio",
        text: entity.value,
        entities: [entity],
      });
    }

    case "approach.ready":
      return print({ ...state, approach: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: event.payload.coverage
          ? `Approach read — ${event.payload.building_type.toLowerCase()}`
          : "Approach — no Street View coverage at this address",
      });

    case "agent.step":
      return print(
        {
          ...state,
          agentSteps: [
            ...state.agentSteps,
            {
              step: event.payload.step,
              action: event.payload.action,
              thought: event.payload.thought,
            },
          ],
        },
        {
          ts: event.ts,
          kind: "agent",
          step: event.payload.step,
          action: event.payload.action,
          text: event.payload.thought,
        },
      );

    case "agent.artifacts":
      return print({ ...state, artifacts: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: `Listing captured — floor plan and ${event.payload.photos.length} photos`,
      });

    case "rooms.graph":
      return print({ ...state, graph: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: `Room graph — ${event.payload.rooms.length} rooms`,
      });

    case "scene.ready":
      return print({ ...state, scene: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: `Scene reconstructed — ${event.payload.room_id.replace("_", " ")}`,
      });

    case "route.planned":
      return print({ ...state, route: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: `Route planned — entry via ${event.payload.entry_point}`,
      });

    case "briefing.ready":
      return print({ ...state, briefing: event.payload }, {
        ts: event.ts,
        kind: "system",
        text: `Crew brief ready — ${event.payload.duration_s}s`,
      });

    case "radio.update":
      return print(state, { ts: event.ts, kind: "radio", text: event.payload.text });

    case "status":
      return {
        ...state,
        stages: {
          ...state.stages,
          [event.payload.stage]: {
            state: event.payload.state,
            message: event.payload.message,
          },
        },
      };

    default:
      return state;
  }
}

type Action = { kind: "event"; event: BusEvent } | { kind: "reset" };

function rootReducer(state: IncidentState, action: Action): IncidentState {
  if (action.kind === "reset") return emptyIncident();
  return reduce(state, action.event);
}

export function useIncident() {
  const [state, dispatch] = useReducer(rootReducer, undefined, emptyIncident);

  const apply = useCallback((event: BusEvent) => dispatch({ kind: "event", event }), []);
  const reset = useCallback(() => dispatch({ kind: "reset" }), []);

  const address = useMemo(
    () => state.entities.find((entity) => entity.type === "ADDRESS")?.value ?? null,
    [state.entities],
  );

  return { state, apply, reset, address };
}
