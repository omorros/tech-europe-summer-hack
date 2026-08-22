/**
 * One Worker: Next.js UI + the incident bus.
 *
 * FastAPI is the laptop process that still runs the live H agent. The
 * browser never talks to Python directly — it talks HTTP and a WebSocket.
 * Those live here, in a Durable Object, so the deployed console does not
 * wait on a tunnel.
 *
 * Set BACKEND_ORIGIN to send API traffic to FastAPI instead (live scrape).
 */

import { IncidentHub, type Env } from "./lane/incident";

export { IncidentHub };

const API = ["/ws/", "/incident", "/health", "/radio"];

function isApi(pathname: string): boolean {
  return API.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isStatic(pathname: string): boolean {
  return pathname === "/static" || pathname.startsWith("/static/") || pathname.startsWith("/cache/");
}

async function proxy(request: Request, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const target = origin.replace(/\/$/, "") + url.pathname + url.search;
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return fetch(target, request);
  }
  return fetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    // @ts-expect-error duplex is required to stream a request body on Workers
    duplex: "half",
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = (env.BACKEND_ORIGIN || "").replace(/\/$/, "");

    if (isStatic(url.pathname)) {
      const local = await env.ASSETS.fetch(request);
      if (local.ok || local.status !== 404) return local;
      if (origin) return proxy(request, origin);
      return local;
    }

    if (isApi(url.pathname)) {
      if (origin) return proxy(request, origin);
      const id = env.INCIDENT.idFromName("live");
      return env.INCIDENT.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
