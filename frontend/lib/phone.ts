import { wsUrl } from "./config";

export type PhoneSocket = {
  send: (message: Record<string, unknown>) => void;
  close: () => void;
};

const CONNECT_TIMEOUT_MS = 2500;

/**
 * The handset's leg of the call: `/ws/phone` on the FastAPI process.
 *
 * Resolves null if the backend is not reachable within the timeout, which is
 * the signal for /phone to fall back to BroadcastChannel. `onClose` fires if
 * the socket dies later, so the handset can stop claiming to be live.
 */
export function connectPhone(onClose?: () => void): Promise<PhoneSocket | null> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl("/ws/phone"));
    } catch {
      resolve(null);
      return;
    }

    const finish = (value: PhoneSocket | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      socket.close();
      finish(null);
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      window.clearTimeout(timer);
      finish({
        send: (message) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
        },
        close: () => socket.close(),
      });
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      socket.close();
      finish(null);
    };
    socket.onclose = () => {
      window.clearTimeout(timer);
      // Closed before it ever opened is a failed connect, not a drop, and the
      // caller has not been told the line was live. Only report a real drop.
      const wasOpen = settled;
      finish(null);
      if (wasOpen) onClose?.();
    };
  });
}
