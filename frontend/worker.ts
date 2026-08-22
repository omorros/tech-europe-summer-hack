/**
 * Serves the exported Next.js UI and proxies API/WebSocket/static traffic
 * to the FastAPI process.
 *
 * BACKEND_ORIGIN must be a public HTTPS URL (cloudflared tunnel) — the
 * Worker cannot reach localhost on your laptop.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  BACKEND_ORIGIN: string;
}

const PROXY_PREFIXES = ["/ws/", "/incident", "/health", "/static/", "/radio"];

const UNSET_MESSAGE =
  "BACKEND_ORIGIN is unset. Run a cloudflared tunnel to the FastAPI process " +
  "and set that https URL as the Worker var (or open this page with " +
  "?backend=https://….trycloudflare.com).";

function shouldProxy(pathname: string): boolean {
  return PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!shouldProxy(url.pathname)) return env.ASSETS.fetch(request);

    const origin = (env.BACKEND_ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      return Response.json({ ok: false, error: UNSET_MESSAGE }, { status: 503 });
    }
    const target = origin + url.pathname + url.search;

    // A WebSocket handshake has to reach the origin as it arrived: passing the
    // original Request keeps the Upgrade headers, and the 101 comes back with
    // its `webSocket` attached. Rebuilding the request loses both.
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
  },
};
