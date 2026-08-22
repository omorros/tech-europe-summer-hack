"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitRemote, now } from "@/lib/bus";
import { consumeBackendParam } from "@/lib/config";
import { connectPhone, type PhoneSocket } from "@/lib/phone";
import {
  listen,
  speechAvailable,
  SPEECH_MESSAGE,
  type SpeechFailure,
  type SpeechSession,
} from "@/lib/speech";
import {
  record,
  recorderAvailable,
  RECORDER_MESSAGE,
  type RecorderFailure,
  type RecorderSession,
} from "@/lib/recorder";
import { SyntheticStamp } from "@/components/plates";

type CallState = "idle" | "dialling" | "connected" | "ended";

interface Heard {
  seq: number;
  text: string;
  isFinal: boolean;
}

export default function PhonePage() {
  const [call, setCall] = useState<CallState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<Heard[]>([]);
  const [failure, setFailure] = useState<SpeechFailure | null>(null);
  const [recorderFailure, setRecorderFailure] = useState<RecorderFailure | null>(null);
  const [pending, setPending] = useState(false);

  const callId = useRef("999-0417");
  const phone = useRef<PhoneSocket | null>(null);
  const speech = useRef<SpeechSession | null>(null);
  const recorder = useRef<RecorderSession | null>(null);
  /** Said before the socket finished opening. Flushed in order once it does. */
  const backlog = useRef<Heard[]>([]);
  const socketSettled = useRef(false);

  /** Whatever the caller just said, up the socket or across the tabs. */
  const sayIt = useCallback((seq: number, text: string, isFinal: boolean) => {
    // Chrome will not start recognition from an async continuation, so we
    // listen on the click and the socket connects underneath. Anything said in
    // that window waits here rather than being lost.
    if (!socketSettled.current) {
      backlog.current.push({ seq, text, isFinal });
      return;
    }
    if (phone.current) {
      phone.current.send({ type: "transcript", seq, text, is_final: isFinal });
      return;
    }
    emitRemote({
      type: "transcript.fragment",
      ts: now(),
      payload: {
        call_id: callId.current,
        seq,
        text,
        is_final: isFinal,
        speaker: "caller",
      },
    });
  }, []);

  useEffect(() => {
    consumeBackendParam();
    return () => {
      speech.current?.stop();
      recorder.current?.stop();
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

    void (async () => {
      const socket = await connectPhone(() => setLive(false));
      if (cancelled) {
        socket?.close();
        return;
      }

      if (socket) {
        phone.current = socket;
        // No address: the caller is about to say one, and the backend starts
        // the lanes off the ADDRESS entity the extractor pulls out of it.
        socket.send({ type: "call.start" });
        setLive(true);

        // The backend is up, so OpenAI does the listening. It transcribes the
        // chunk and ingests it itself, which is what fills the record — the
        // handset only shows the caller what was heard.
        recorder.current = await record({
          onText: (text, seq) => {
            setHeard((current) => [...current, { seq, text, isFinal: true }].slice(-6));
          },
          onFailure: (reason) => setRecorderFailure(reason),
          onRecordingChange: setListening,
          onPendingChange: setPending,
        });
      } else {
        // No backend to transcribe with: fall back to the browser's own
        // recogniser and the same-device bus, so the demo still runs.
        setLive(false);
        emitRemote({ type: "call.incoming", ts: now(), payload: { call_id: callId.current } });
        emitRemote({ type: "call.answered", ts: now(), payload: { call_id: callId.current } });
        speech.current = listen({
          onFragment: ({ seq, text, isFinal }) => {
            sayIt(seq, text, isFinal);
            setHeard((current) => {
              const next = current.filter((line) => line.seq !== seq);
              next.push({ seq, text, isFinal });
              return next.slice(-6);
            });
          },
          onFailure: (reason) => setFailure(reason),
          onListeningChange: setListening,
        });
      }

      socketSettled.current = true;
      const waiting = backlog.current;
      backlog.current = [];
      waiting.forEach((line) => sayIt(line.seq, line.text, line.isFinal));

      setCall("connected");
      setSeconds(0);
    })();

    return () => {
      cancelled = true;
    };
  }, [call, sayIt]);

  /** The microphone opens on the click itself — see sayIt. */
  const placeCall = () => {
    // Both ears need a secure context and a microphone; if neither is possible
    // there is no call to place, and the reason is worth saying out loud.
    const noRecorder = recorderAvailable();
    const noSpeech = speechAvailable();
    if (noRecorder && noSpeech) {
      setRecorderFailure(noRecorder);
      return;
    }
    setFailure(null);
    setRecorderFailure(null);
    setHeard([]);
    backlog.current = [];
    socketSettled.current = false;
    setCall("dialling");
  };

  const end = () => {
    speech.current?.stop();
    speech.current = null;
    recorder.current?.stop();
    recorder.current = null;
    setListening(false);
    socketSettled.current = false;
    backlog.current = [];
    setCall("ended");
    if (phone.current) {
      phone.current.send({ type: "call.end" });
      phone.current.close();
      phone.current = null;
    } else {
      emitRemote({ type: "call.ended", ts: now(), payload: { call_id: callId.current } });
    }
  };

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="phone">
      <div className="stamp stamp-bar stamp-bar--steel">
        <span style={{ flex: 1 }}>Lantern · Caller</span>
        <span>{live ? "live" : "local"}</span>
        {!live && <SyntheticStamp paper={false} />}
      </div>

      <div className="phone__body">
        {call === "idle" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Emergency
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              Tap to place the 999 call, then speak. Say the address and what is
              happening — the console hears it as you say it.
            </p>
            {recorderFailure && (
              <p className="phone__failure">{RECORDER_MESSAGE[recorderFailure]}</p>
            )}
            {failure && <p className="phone__failure">{SPEECH_MESSAGE[failure]}</p>}
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
              Connected · {clock}
              {listening ? " · listening" : " · paused"}
              {pending ? " · transcribing" : ""}
            </p>
            {heard.length === 0 ? (
              <h1 className="huge" style={{ margin: 0 }}>
                Speak
              </h1>
            ) : (
              <div className="phone__heard">
                {heard.map((line) => (
                  <p
                    key={line.seq}
                    className={line.isFinal ? "phone__line" : "phone__line phone__line--partial"}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            )}
            {recorderFailure && (
              <p className="phone__failure">{RECORDER_MESSAGE[recorderFailure]}</p>
            )}
            {failure && <p className="phone__failure">{SPEECH_MESSAGE[failure]}</p>}
          </>
        )}

        {call === "ended" && (
          <>
            <h1 className="huge" style={{ margin: 0 }}>
              Call ended
            </h1>
            <p style={{ color: "var(--steel-dim)", margin: 0 }}>
              {clock} — the console keeps running.
            </p>
          </>
        )}
      </div>

      <div className="phone__foot">
        {call === "idle" && (
          <button type="button" className="dial" onClick={placeCall}>
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
            {!live && (failure === "needs-gesture" || !listening) && (
              <button
                type="button"
                className="control control--solid"
                style={{ width: "100%", padding: "1.1em" }}
                onClick={() => {
                  setFailure(null);
                  speech.current?.resume();
                }}
              >
                Keep listening
              </button>
            )}
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
              setHeard([]);
              setFailure(null);
              setRecorderFailure(null);
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
