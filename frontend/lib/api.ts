import { httpUrl } from "./config";

/**
 * The two HTTP calls the console makes. Everything else arrives on the socket.
 *
 * Both carry a deadline. A backend that is routable but wedged — a tunnel
 * pointing at a dead process, most likely — would otherwise leave the operator
 * looking at a button that says "Opening…" until the browser gives up, when
 * the honest answer is "not there, use the recorded run".
 */

const TIMEOUT_MS = 4000;

export interface IncidentResponse {
  call_id: string;
  address: string | null;
}

async function post(path: string, body: unknown): Promise<Response | null> {
  try {
    const response = await fetch(httpUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

export async function startIncident(input: {
  address?: string;
  replay?: boolean;
}): Promise<IncidentResponse | null> {
  const response = await post("/incident", {
    address: input.address ?? "",
    replay: Boolean(input.replay),
  });
  if (!response) return null;
  try {
    return (await response.json()) as IncidentResponse;
  } catch {
    return null;
  }
}

/** Fireground traffic. Used when the console socket is not up to carry it. */
export async function sendRadio(text: string): Promise<boolean> {
  return (await post("/radio", { text })) !== null;
}
