"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { connectBus } from "./bus";
import { buildTimeline } from "./timeline";
import { useIncident, type IncidentState } from "./useIncident";
import { useRunner } from "./useRunner";
import type { BusEvent } from "./types";

interface IncidentContextValue {
  state: IncidentState;
  started: boolean;
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
 */
export function IncidentProvider({ children }: { children: React.ReactNode }) {
  const { state, apply, reset } = useIncident();
  const { run, clear } = useRunner(apply);
  const [started, setStarted] = useState(false);
  const handedOver = useRef(false);

  const start = useCallback(() => {
    clear();
    reset();
    setStarted(true);
    handedOver.current = false;
    run(buildTimeline());
  }, [clear, reset, run]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("run")) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      connectBus((event: BusEvent) => {
        if (event.type === "call.incoming") start();
      }),
    [start],
  );

  // Hidden fallback: replay the recorded call with no phone involved.
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
    <IncidentContext.Provider value={{ state, started, start, handedOver }}>
      {children}
    </IncidentContext.Provider>
  );
}

export function useIncidentContext(): IncidentContextValue {
  const value = useContext(IncidentContext);
  if (!value) throw new Error("useIncidentContext must be used inside IncidentProvider");
  return value;
}
