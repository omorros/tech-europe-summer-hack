import type { BusEvent } from "./types";
import { consumeBackendParam, wsUrl } from "./config";

/**
 * Prefer `/ws/console` on the FastAPI process. Fall back to BroadcastChannel
 * so /phone and /console still talk on one machine when the backend is down.
 *
 * The server stamps every frame with a monotonic `seq` and a per-process
 * `boot`. On reconnect it replays its recent history, so without dedupe a
 * dropped socket would print the whole call a second time. We keep the
 * highest `seq` applied and ignore anything at or below it — and forget that
 * number when `boot` changes, because a restarted backend counts from one.
 */

const CHANNEL = "sizeup";
const RECONNECT_CEILING_MS = 10_000;

type Handler = (event: BusEvent) => void;
type StatusHandler = (open: boolean) => void;

/** The wire adds two envelope fields to the locked {type, ts, payload}. */
type Frame = BusEvent & { seq?: number; boot?: string };

const handlers = new Set<Handler>();
const statusHandlers = new Set<StatusHandler>();
let channel: BroadcastChannel | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let attempts = 0;
let lastSeq = 0;
let boot: string | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!("BroadcastChannel" in window)) return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => dispatch(message.data as BusEvent);
  }
  return channel;
}

function dispatch(event: BusEvent): void {
  handlers.forEach((handler) => handler(event));
}

function announce(open: boolean): void {
  statusHandlers.forEach((handler) => handler(open));
}

function receive(raw: string): void {
  let frame: Frame;
  try {
    frame = JSON.parse(raw) as Frame;
  } catch {
    return;
  }

  if (frame.boot && frame.boot !== boot) {
    // New backend process: its sequence starts again, so ours must too.
    boot = frame.boot;
    lastSeq = 0;
  }
  // The hello frame carries no payload; it exists to report `boot`.
  if ((frame.type as string) === "_hello") return;

  if (typeof frame.seq === "number") {
    if (frame.seq <= lastSeq) return;
    lastSeq = frame.seq;
  }
  dispatch(frame);
}

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  // Nothing is listening: `connectBus` reopens when a page mounts again.
  if (handlers.size === 0 || reconnectTimer !== null) return;
  const delay = Math.min(500 * 2 ** attempts, RECONNECT_CEILING_MS);
  attempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket(): void {
  if (typeof window === "undefined" || socket) return;
  clearReconnect();
  consumeBackendParam();

  let next: WebSocket;
  try {
    next = new WebSocket(wsUrl("/ws/console"));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = next;

  next.onopen = () => {
    attempts = 0;
    announce(true);
  };
  next.onmessage = (message) => receive(message.data as string);
  next.onclose = () => {
    // Only retire the live socket: a stale handler must not clear a newer one.
    if (socket !== next) return;
    socket = null;
    announce(false);
    scheduleReconnect();
  };
  next.onerror = () => next.close();
}

export function connectBus(handler: Handler): () => void {
  ensureChannel();
  handlers.add(handler);
  openSocket();
  return () => {
    handlers.delete(handler);
  };
}

/** Reports whether the console socket is up, for the "live vs replay" label. */
export function subscribeBusStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  handler(socket?.readyState === WebSocket.OPEN);
  return () => {
    statusHandlers.delete(handler);
  };
}

/** Emit only to other tabs. Used when the sender renders its own state directly. */
export function emitRemote(event: BusEvent): void {
  ensureChannel()?.postMessage(event);
}

export function sendConsole(event: { type: string; payload?: unknown }): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
    return true;
  }
  return false;
}

export function now(): number {
  return Date.now();
}

export function consoleSocketOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    clearReconnect();
    handlers.clear();
    socket?.close();
  });
}
