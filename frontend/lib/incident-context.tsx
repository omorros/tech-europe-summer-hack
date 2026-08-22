"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { startIncident } from "./api";
import { connectBus, subscribeBusStatus } from "./bus";
import { consumeBackendParam } from "./config";
import { buildTimeline } from "./timeline";
import { useIncident, type IncidentState } from "./useIncident";
import { useRunner } from "./useRunner";
import type { BusEvent } from "./types";

interface IncidentContextValue {
  state: IncidentState;
  started: boolean;
  live: boolean;
  start: () => void;
  /** True once the console has handed the screen to /video for this run. It
   *  lives here, not in the page, because the page unmounts on navigation and
   *  a per-page flag would re-fire the handover every time you came back. */
  handedOver: React.MutableRefObject<boolean>;
}

const IncidentContext = createContext<IncidentContextValue | null>(null);

/**
 * Holds the run for both /console and /video. It sits in the shared layout so
 * moving between the two routes never restarts or loses the incident.
 *
 * Live events arrive from `/ws/console`. Press R (or `?run=1`) to start a
 * new incident: the backend if it is up, the local synthetic timeline if not.
 */
export function IncidentProvider({ children }: { children: React.ReactNode }) {
  const { state, apply, reset } = useIncident();
  const { run, clear } = useRunner(apply);
  const [started, setStarted] = useState(false);
  const [live, setLive] = useState(false);
  const handedOver = useRef(false);
  /** Only the most recent start may fall back, so a slow reply from an
   *  abandoned attempt cannot drop a synthetic timeline over a live call. */
  const attempt = useRef(0);
  const lastCallId = useRef<string | null>(null);

  const start = useCallback(() => {
    clear();
    reset();
    setStarted(true);
    handedOver.current = false;
    attempt.current += 1;
    const mine = attempt.current;
    void (async () => {
      const remote = await startIncident({ replay: true });
      if (mine !== attempt.current) return;
      // The backend drives everything over the socket from here. Only replay
      // the built-in timeline when there is nothing on the other end.
      if (!remote) run(buildTimeline());
    })();
  }, [clear, reset, run]);

  useEffect(() => subscribeBusStatus(setLive), []);

  useEffect(() => {
    consumeBackendParam();
    if (new URLSearchParams(window.location.search).has("run")) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      connectBus((event: BusEvent) => {
        // A different call_id means a new incident: drop any local replay
        // still running and clear the board before the first event lands.
        if (event.type === "call.incoming" && event.payload.call_id !== lastCallId.current) {
          lastCallId.current = event.payload.call_id;
          clear();
          reset();
          setStarted(true);
          handedOver.current = false;
        }
        apply(event);
      }),
    [apply, clear, reset],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key.toLowerCase() === "r") start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  return (
    <IncidentContext.Provider value={{ state, started, live, start, handedOver }}>
      {children}
    </IncidentContext.Provider>
  );
}

export function useIncidentContext(): IncidentContextValue {
  const value = useContext(IncidentContext);
  if (!value) throw new Error("useIncidentContext must be used inside IncidentProvider");
  return value;
}
