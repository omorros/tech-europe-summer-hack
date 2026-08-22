"use client";

import { useEffect, useRef, useState } from "react";
import { emitRemote, now } from "@/lib/bus";
import { DEMO_ADDRESS } from "@/lib/timeline";
import { SyntheticStamp } from "@/components/plates";

type CallState = "idle" | "dialling" | "connected" | "ended";

/** Cue cards for the person holding the handset on stage. */
const SCRIPT = [
  "Fire! There's a fire!",
  `It's ${DEMO_ADDRESS.replace(",", " —")}`,
  "The kitchen's on fire, there's smoke everywhere down here",
  "My mum's upstairs, she's in the back bedroom, she can't get down",
  "We can't get out the back, the bins are against the door",
];

export default function PhonePage() {
  const [call, setCall] = useState<CallState>("idle");
  const [cue, setCue] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const callId = useRef("999-0417");

  useEffect(() => {
    if (call !== "connected") return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [call]);

  useEffect(() => {
    if (call !== "dialling") return;
    const id = window.setTimeout(() => {
      setCall("connected");
      setSeconds(0);
      setCue(0);
      // This is the signal the console listens for. When /ws/phone is live it
      // becomes the real call.incoming from the server.
      emitRemote({
        type: "call.incoming",
        ts: now(),
        payload: { call_id: callId.current },
      });
    }, 1600);
    return () => window.clearTimeout(id);
  }, [call]);

  const end = () => {
    setCall("ended");
    emitRemote({ type: "call.ended", ts: now(), payload: { call_id: callId.current } });
  };

  return (
    <main className="phone">
      <div className="stamp stamp-bar stamp-bar--steel">
        <span style={{ flex: 1 }}>Lantern · Caller</span>
        <SyntheticStamp paper={false} />
      </div>

      <div className="phone__body">
        {call === "idle" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Emergency
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              Tap to place the mock 999 call. The dispatch console picks it up and
              starts the run.
            </p>
          </>
        )}

        {call === "dialling" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Dialling
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>999 — Fire</p>
          </>
        )}

        {call === "connected" && (
          <>
            <p className="stamp" style={{ color: "var(--hivis)", margin: 0 }}>
              Connected · {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </p>
            <h1 className="huge" style={{ margin: 0 }}>
              {SCRIPT[cue]}
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              Cue {cue + 1} of {SCRIPT.length} — say this, then tap next.
            </p>
          </>
        )}

        {call === "ended" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Call ended
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")} — the console keeps running.
            </p>
          </>
        )}
      </div>

      <div className="phone__foot">
        {call === "idle" && (
          <button type="button" className="dial" onClick={() => setCall("dialling")}>
            Call 999
          </button>
        )}
        {call === "dialling" && (
          <button type="button" className="dial dial--end" onClick={end}>
            Cancel
          </button>
        )}
        {call === "connected" && (
          <>
            <button
              type="button"
              className="control control--solid"
              style={{ width: "100%", padding: "1.1em" }}
              disabled={cue >= SCRIPT.length - 1}
              onClick={() => setCue((value) => Math.min(value + 1, SCRIPT.length - 1))}
            >
              Next line
            </button>
            <button type="button" className="dial dial--end" onClick={end}>
              End call
            </button>
          </>
        )}
        {call === "ended" && (
          <button
            type="button"
            className="control"
            style={{ width: "100%", padding: "1.1em" }}
            onClick={() => {
              setCall("idle");
              setSeconds(0);
              setCue(0);
            }}
          >
            Reset handset
          </button>
        )}
      </div>
    </main>
  );
}
