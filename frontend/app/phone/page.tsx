"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitRemote, now } from "@/lib/bus";
import { consumeBackendParam } from "@/lib/config";
import { connectPhone, type PhoneSocket } from "@/lib/phone";
import { SyntheticStamp } from "@/components/plates";

type CallState = "idle" | "dialling" | "connected" | "ended";

/** One of the five warmed listings on this Worker — so approach/plan/rooms
 *  and the cached walkthrough actually land on the console. */
const CALL_ADDRESS = "14 Deerdale Road, London SE24 0AW";

const SCRIPT = [
  "Fire! There's a fire!",
  `It's ${CALL_ADDRESS.replace(",", " —")}`,
  "The kitchen's on fire, there's smoke everywhere down here",
  "My mum's upstairs, she's in the back bedroom, she can't get down",
  "We can't get out the back, the bins are against the door",
];

export default function PhonePage() {
  const [call, setCall] = useState<CallState>("idle");
  const [cue, setCue] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState(false);
  const callId = useRef("999-0417");
  const phone = useRef<PhoneSocket | null>(null);

  /** One cue, either up the socket or across the tabs on this machine. */
  const say = useCallback((index: number) => {
    const text = SCRIPT[index];
    if (phone.current) {
      phone.current.send({ type: "transcript", seq: index, text, is_final: true });
      return;
    }
    emitRemote({
      type: "transcript.fragment",
      ts: now(),
      payload: {
        call_id: callId.current,
        seq: index,
        text,
        is_final: true,
        speaker: "caller",
      },
    });
  }, []);

  useEffect(() => {
    consumeBackendParam();
    return () => {
      phone.current?.close();
      phone.current = null;
    };
  }, []);

  useEffect(() => {
    if (call !== "connected") return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [call]);

  useEffect(() => {
    if (call !== "dialling") return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const socket = await connectPhone(() => setLive(false));
        if (cancelled) {
          socket?.close();
          return;
        }
        if (socket) {
          phone.current = socket;
          socket.send({ type: "call.start" });
          socket.send({ type: "transcript", seq: 0, text: SCRIPT[0], is_final: true });
          setLive(true);
        } else {
          setLive(false);
          emitRemote({
            type: "call.incoming",
            ts: now(),
            payload: { call_id: callId.current },
          });
          emitRemote({
            type: "call.answered",
            ts: now(),
            payload: { call_id: callId.current },
          });
          say(0);
        }
        setCall("connected");
        setSeconds(0);
        setCue(0);
      })();
    }, 1600);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [call, say]);

  const end = () => {
    setCall("ended");
    if (phone.current) {
      phone.current.send({ type: "call.end" });
      phone.current.close();
      phone.current = null;
    } else {
      emitRemote({ type: "call.ended", ts: now(), payload: { call_id: callId.current } });
    }
  };

  return (
    <main className="phone">
      <div className="stamp stamp-bar stamp-bar--steel">
        <span style={{ flex: 1 }}>Lantern · Caller</span>
        <span>{live ? "live" : "local"}</span>
        <SyntheticStamp paper={false} />
      </div>

      <div className="phone__body">
        {call === "idle" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Emergency
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              Tap to place the 999 call. The dispatch console picks it up and
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
              onClick={() => {
                const next = Math.min(cue + 1, SCRIPT.length - 1);
                setCue(next);
                say(next);
              }}
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
              setLive(false);
            }}
          >
            Reset handset
          </button>
        )}
      </div>
    </main>
  );
}
