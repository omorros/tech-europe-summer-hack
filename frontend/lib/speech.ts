/**
 * The caller's voice, turned into transcript fragments in the browser.
 *
 * `/ws/phone` wants text, not audio, so the recognition happens here and only
 * words cross the wire. Interim results ride the same `seq` as the final that
 * follows them, which is what lets the console print a line in carbon and
 * strike it to ink when it settles.
 *
 * Web Speech API. Chrome sends the audio to Google for recognition, so this
 * needs a network and it needs a secure context — HTTPS or localhost. A phone
 * reaching a dev server by LAN IP is NOT a secure context and the browser will
 * refuse the microphone before the user ever sees a prompt. See
 * docs/INTEGRATION.md §1: cloudflared is the way round it.
 */

export type SpeechFragment = { seq: number; text: string; isFinal: boolean };

export type SpeechFailure =
  | "unsupported"
  | "insecure-context"
  | "not-allowed"
  | "no-audio"
  | "network"
  | "needs-gesture"
  | "unknown";

export interface SpeechSession {
  stop: () => void;
  /** Restart after iOS dropped us and refused to resume on its own. Must be
   *  called from a real tap, or Safari refuses again. */
  resume: () => void;
}

interface SpeechHandlers {
  onFragment: (fragment: SpeechFragment) => void;
  onFailure: (reason: SpeechFailure, detail?: string) => void;
  onListeningChange?: (listening: boolean) => void;
}

/** Minimal shape of the vendor-prefixed API; no lib.dom types ship for it. */
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
    length: number;
  }>;
}

function recognitionConstructor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechAvailable(): SpeechFailure | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure-context";
  if (!recognitionConstructor()) return "unsupported";
  return null;
}

export const SPEECH_MESSAGE: Record<SpeechFailure, string> = {
  unsupported:
    "This browser cannot transcribe speech. Chrome can. Use the console's R key to replay the recorded call instead.",
  "insecure-context":
    "The microphone needs HTTPS or localhost. Reaching this page by IP address will not work — run it through a tunnel.",
  "not-allowed":
    "Microphone permission was refused. Allow it in the browser's site settings and call again.",
  "no-audio": "No microphone was found on this device.",
  network: "Speech recognition lost the network. It needs one to transcribe.",
  "needs-gesture":
    "The phone stopped listening between sentences. Tap Keep listening and carry on — iPhones need a tap to reopen the microphone.",
  unknown: "Speech recognition stopped unexpectedly.",
};

/**
 * Starts listening and streams fragments until `stop()`.
 *
 * Chrome ends a recognition run after a stretch of silence even in continuous
 * mode; a 999 caller pauses constantly, so `onend` restarts it rather than
 * letting the call go deaf halfway through.
 */
export function listen({
  onFragment,
  onFailure,
  onListeningChange,
}: SpeechHandlers): SpeechSession {
  const blocked = speechAvailable();
  if (blocked) {
    onFailure(blocked);
    return { stop: () => {}, resume: () => {} };
  }

  const Recognition = recognitionConstructor()!;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-GB";
  recognition.maxAlternatives = 1;

  let stopped = false;
  let restartWatch: number | undefined;
  // One seq per utterance: interims and the final that replaces them share it,
  // so the console updates that line in place instead of printing it twice.
  let seq = 0;

  const clearWatch = () => {
    if (restartWatch !== undefined) {
      window.clearTimeout(restartWatch);
      restartWatch = undefined;
    }
  };

  recognition.onstart = () => {
    clearWatch();
    onListeningChange?.(true);
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      onFragment({ seq: seq + i, text, isFinal: result.isFinal });
      if (result.isFinal) seq = seq + i + 1;
    }
  };

  recognition.onerror = (event) => {
    // Silence is not a failure on a 999 call; onend restarts us.
    if (event.error === "no-speech" || event.error === "aborted") return;
    const reason: SpeechFailure =
      event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "not-allowed"
        : event.error === "audio-capture"
          ? "no-audio"
          : event.error === "network"
            ? "network"
            : "unknown";
    stopped = reason === "not-allowed" || reason === "no-audio";
    onFailure(reason, event.message);
  };

  // iOS ends recognition after almost every utterance and ignores `continuous`,
  // so a 999 call goes deaf mid-sentence unless we restart it. Safari also
  // refuses a restart that did not come from a tap, and it refuses *silently* —
  // no throw, no error event, `onstart` simply never fires. So watch for that
  // and ask the caller for the tap rather than pretending to still listen.
  recognition.onend = () => {
    onListeningChange?.(false);
    if (stopped) return;
    try {
      recognition.start();
      clearWatch();
      restartWatch = window.setTimeout(() => onFailure("needs-gesture"), 1200);
    } catch {
      onFailure("needs-gesture");
    }
  };

  try {
    recognition.start();
  } catch (error) {
    onFailure("unknown", error instanceof Error ? error.message : undefined);
  }

  return {
    stop: () => {
      stopped = true;
      clearWatch();
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
    resume: () => {
      if (stopped) return;
      clearWatch();
      try {
        recognition.start();
      } catch {
        /* already running */
      }
    },
  };
}
