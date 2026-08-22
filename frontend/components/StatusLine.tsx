"use client";

import { useEffect, useState } from "react";
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

/**
 * One line. Carries the four call events and all eight stage events that
 * otherwise render nowhere — at record size, so it reads at four metres
 * without becoming a second dashboard.
 */
export function StatusLine({ state }: { state: IncidentState }) {
  const elapsed = useElapsed(state.callState === "answered");

  const done = STAGES.filter(({ id }) => state.stages[id].state === "done");
  const running = STAGES.filter(({ id }) => state.stages[id].state === "running");
  const failed = STAGES.filter(({ id }) => state.stages[id].state === "error");

  const parts: string[] = [
    state.callState === "answered"
      ? `${CALL_WORD.answered} ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
      : CALL_WORD[state.callState],
  ];

  if (done.length > 0) parts.push(`${done.length} of ${STAGES.length} done`);
  if (running.length > 0) parts.push(`${running.map((stage) => stage.label).join(", ")} running`);

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
