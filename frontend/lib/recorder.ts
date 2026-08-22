import { httpUrl } from "./config";

/**
 * The caller's voice, recorded in short complete chunks and posted to the
 * backend, which transcribes it with OpenAI and puts the text on the bus.
 *
 * Why chunks rather than one stream: MediaRecorder's later fragments are not
 * independently decodable — only the first carries the container header — so a
 * mid-stream blob is not a file any decoder will accept. Stopping and starting
 * gives a complete, valid recording every time at the cost of a few ms gap.
 *
 * Still needs a secure context. getUserMedia refuses on plain http from
 * anything but localhost, which is what a phone on the hotspot would be.
 */

export type RecorderFailure =
  | "insecure-context"
  | "unsupported"
  | "not-allowed"
  | "no-audio"
  | "backend"
  | "unknown";

export const RECORDER_MESSAGE: Record<RecorderFailure, string> = {
  "insecure-context":
    "The microphone needs HTTPS or localhost. Reaching this page by IP address will not work — run it through a tunnel.",
  unsupported: "This browser cannot record audio.",
  "not-allowed":
    "Microphone permission was refused. Allow it in the browser's site settings and call again.",
  "no-audio": "No microphone was found on this device.",
  backend:
    "The backend did not accept the audio. Check the detail: a 503 means the Worker has no BACKEND_ORIGIN, a 404 means /transcribe is not proxied, and a 500 usually means OPENAI_API_KEY is unset.",
  unknown: "Recording stopped unexpectedly.",
};

export interface RecorderSession {
  stop: () => void;
}

interface RecorderHandlers {
  /** A finished chunk came back as text. Empty text means silence. */
  onText: (text: string, seq: number) => void;
  onFailure: (reason: RecorderFailure, detail?: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  /** A chunk is in flight, so the caller can see the call is working. */
  onPendingChange?: (pending: boolean) => void;
}

/** Long enough to catch a whole sentence, short enough to feel live. */
const CHUNK_MS = 4000;

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4", // Safari
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function recorderAvailable(): RecorderFailure | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure-context";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  if (!pickMimeType()) return "unsupported";
  return null;
}

export async function record({
  onText,
  onFailure,
  onRecordingChange,
  onPendingChange,
}: RecorderHandlers): Promise<RecorderSession | null> {
  const blocked = recorderAvailable();
  if (blocked) {
    onFailure(blocked);
    return null;
  }

  const mimeType = pickMimeType()!;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    onFailure(
      name === "NotAllowedError" || name === "SecurityError"
        ? "not-allowed"
        : name === "NotFoundError"
          ? "no-audio"
          : "unknown",
    );
    return null;
  }

  let stopped = false;
  let seq = 0;
  let inFlight = 0;
  let recorder: MediaRecorder | null = null;

  const send = async (blob: Blob, chunkSeq: number) => {
    // A chunk of near-silence is a few hundred bytes of container and nothing
    // else; sending it wastes a request and returns nothing.
    if (blob.size < 2000) return;
    inFlight += 1;
    onPendingChange?.(true);
    try {
      const response = await fetch(
        httpUrl(`/transcribe?seq=${chunkSeq}&mime=${encodeURIComponent(mimeType)}`),
        { method: "POST", body: blob, headers: { "content-type": mimeType } },
      );
      if (!response.ok) {
        // A Worker 503 (BACKEND_ORIGIN unset) and an asset-router 404 (path not
        // proxied) are different problems from a missing key. Say which.
        const body = await response.text().catch(() => "");
        onFailure("backend", `HTTP ${response.status} ${body.slice(0, 200)}`);
        return;
      }
      const data = (await response.json()) as { text?: string };
      if (data.text) onText(data.text, chunkSeq);
    } catch (error) {
      onFailure("backend", error instanceof Error ? error.message : undefined);
    } finally {
      inFlight -= 1;
      if (inFlight === 0) onPendingChange?.(false);
    }
  };

  const cycle = () => {
    if (stopped) return;
    const parts: Blob[] = [];
    const chunkSeq = seq;
    seq += 1;

    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      void send(new Blob(parts, { type: mimeType }), chunkSeq);
      // Start the next one immediately so the gap is milliseconds, not seconds.
      cycle();
    };
    recorder.onerror = () => onFailure("unknown");

    try {
      recorder.start();
      onRecordingChange?.(true);
      window.setTimeout(() => {
        if (recorder && recorder.state === "recording") recorder.stop();
      }, CHUNK_MS);
    } catch (error) {
      onFailure("unknown", error instanceof Error ? error.message : undefined);
    }
  };

  cycle();

  return {
    stop: () => {
      stopped = true;
      onRecordingChange?.(false);
      // Let the final chunk finish and post; it is often the most important
      // thing the caller said.
      if (recorder && recorder.state === "recording") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
