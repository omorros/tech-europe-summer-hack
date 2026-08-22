import type { BusEvent } from "./types";

/**
 * SWAP POINT. Today this is a browser-local bus so the UI can be built and
 * demoed with no backend: same-tab listeners plus a BroadcastChannel so
 * /phone and /console talk to each other in two tabs on one machine.
 *
 * When `/ws/console` exists, replace the body of `connectBus` with the socket
 * and leave every call site untouched — the event shapes are already the
 * locked ones from backend/shared/types.py.
 *
 * Known ceiling: BroadcastChannel is same-origin, same-device. Driving
 * /console from a phone on the hotspot needs the real WebSocket.
 */

const CHANNEL = "lantern";

type Handler = (event: BusEvent) => void;

const handlers = new Set<Handler>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (!("BroadcastChannel" in window)) return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      const event = message.data as BusEvent;
      handlers.forEach((handler) => handler(event));
    };
  }
  return channel;
}

export function connectBus(handler: Handler): () => void {
  ensureChannel();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Emit only to other tabs. Used when the sender renders its own state directly. */
export function emitRemote(event: BusEvent): void {
  ensureChannel()?.postMessage(event);
}

export function now(): number {
  return Date.now();
}
