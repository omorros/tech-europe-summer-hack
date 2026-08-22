"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BusEvent } from "./types";

interface Beat {
  at: number;
  event: BusEvent;
}

/**
 * Schedules a list of beats relative to now. One timer per beat — the demo is
 * ~40 events, so a scheduler would be more machinery than the job needs.
 */
export function useRunner(onEvent: (event: BusEvent) => void) {
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const run = useCallback(
    (beats: Beat[], offset = 0) => {
      beats.forEach(({ at, event }) => {
        timers.current.push(
          window.setTimeout(() => onEvent(event), Math.max(0, at - offset)),
        );
      });
    },
    [onEvent],
  );

  useEffect(() => clear, [clear]);

  return { run, clear };
}
