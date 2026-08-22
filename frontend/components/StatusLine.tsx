"use client";

import { useEffect, useRef, useState } from "react";
import { STAGES } from "@/lib/types";
import type { IncidentState } from "@/lib/useIncident";

const CALL_WORD: Record<IncidentState["callState"], string> = {
  idle: "Line open",
  incoming: "Incoming 999",
  answered: "Connected",
  ended: "Caller hung up",
};

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return seconds;
}

/** Extract fires on every transcript fragment, and surfaces Pioneer latency
 *  we want the Fastino judges to see. Show the first message immediately,
 *  then at most one update per `ms`: a plain debounce would stay blank for as
 *  long as partials kept arriving, which is exactly when it matters. */
function useThrottled(value: string, ms: number) {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  const shownAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = value;
    if (timer.current !== null) return;
    const wait = ms - (Date.now() - shownAt.current);
    if (wait <= 0) {
      shownAt.current = Date.now();
      setShown(value);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      shownAt.current = Date.now();
      setShown(latest.current);
    }, wait);
  }, [value, ms]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return shown;
}

export function StatusLine({ state, live }: { state: IncidentState; live?: boolean }) {
  const elapsed = useElapsed(state.callState === "answered");
  const extract = useThrottled(state.stages.extract.message, 250);

  const done = STAGES.filter(({ id }) => state.stages[id].state === "done");
  const running = STAGES.filter(({ id }) => id !== "extract" && state.stages[id].state === "running");
  const failed = STAGES.filter(({ id }) => state.stages[id].state === "error");

  const parts: string[] = [
    state.callState === "answered"
      ? `${CALL_WORD.answered} ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
      : CALL_WORD[state.callState],
  ];

  if (done.length > 0) parts.push(`${done.length} of ${STAGES.length} done`);
  if (running.length > 0) parts.push(`${running.map((stage) => stage.label).join(", ")} running`);
  if (extract) parts.push(extract);

  if (live !== undefined) parts.push(live ? "Live bus" : "Local replay");

  return (
    <p className="status">
      <span>{parts.join(" · ")}</span>
      {failed.length > 0 && (
        <span className="status__failed">
          {failed.map((stage) => stage.label).join(", ")} failed
        </span>
      )}
    </p>
  );
}
