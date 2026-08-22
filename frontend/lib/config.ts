/**
 * Where the FastAPI process lives.
 *
 * Local `next dev`: http://localhost:8000
 * Cloudflare deploy: same origin (the Worker proxies /ws, /incident, /static)
 * Override: ?backend=https://….trycloudflare.com (persisted in localStorage)
 */

const STORAGE_KEY = "sizeup.backend";

/** Resolved once: mediaUrl() runs per <img>, and this reads localStorage. */
let resolved: string | undefined;

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function rememberBackend(url: string): void {
  if (typeof window === "undefined") return;
  const cleaned = trimSlash(url.trim());
  if (cleaned) window.localStorage.setItem(STORAGE_KEY, cleaned);
  else window.localStorage.removeItem(STORAGE_KEY);
  resolved = undefined;
}

export function consumeBackendParam(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("backend");
  if (value) rememberBackend(value);
}

export function backendUrl(): string {
  if (resolved === undefined) resolved = resolveBackend();
  return resolved;
}

function resolveBackend(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return trimSlash(stored);
    const host = window.location.hostname;
    const baked = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
    if (host === "localhost" || host === "127.0.0.1") {
      return trimSlash(baked || "http://localhost:8000");
    }
    // A localhost bake from `next build` on a laptop must not win on Cloudflare.
    if (baked && !/localhost|127\.0\.0\.1/.test(baked)) return trimSlash(baked);
    return "";
  }
  return trimSlash(process.env.NEXT_PUBLIC_BACKEND_URL || "");
}

export function httpUrl(path: string): string {
  const base = backendUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function wsUrl(path: string): string {
  const base = backendUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (base) {
    return `${base.replace(/^http/, "ws")}${suffix}`;
  }
  if (typeof window === "undefined") return suffix;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${suffix}`;
}

export function mediaUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  return httpUrl(url);
}
