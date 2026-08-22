/**
 * fal webhook authenticity check (ED25519).
 *
 * fal signs each webhook with ED25519 and publishes its public keys as a JWKS.
 * The signed message is four lines: request id, user id, timestamp, and the
 * hex SHA-256 of the raw body. Timestamps outside ±5 minutes are rejected so a
 * captured webhook cannot be replayed at us later.
 *
 * Docs: fal.ai/docs/model-apis/model-endpoints/webhooks
 */

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const LEEWAY_SECONDS = 300;

let cachedKeys: { keys: CryptoKey[]; fetchedAt: number } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function publicKeys(): Promise<CryptoKey[]> {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys;
  }
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error(`jwks fetch failed: ${response.status}`);
  const jwks: { keys: Array<{ x: string }> } = await response.json();

  const keys = await Promise.all(
    jwks.keys.map((jwk) =>
      crypto.subtle.importKey("raw", fromBase64Url(jwk.x), { name: "Ed25519" }, false, [
        "verify",
      ]),
    ),
  );
  cachedKeys = { keys, fetchedAt: Date.now() };
  return keys;
}

export async function verifyFalWebhook(
  request: Request,
  rawBody: ArrayBuffer,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const requestId = request.headers.get("X-Fal-Webhook-Request-Id");
  const userId = request.headers.get("X-Fal-Webhook-User-Id");
  const timestamp = request.headers.get("X-Fal-Webhook-Timestamp");
  const signature = request.headers.get("X-Fal-Webhook-Signature");

  if (!requestId || !userId || !timestamp || !signature) {
    return { ok: false, reason: "missing signature headers" };
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > LEEWAY_SECONDS) {
    return { ok: false, reason: "timestamp outside ±5 minutes" };
  }

  const bodyHash = hex(await crypto.subtle.digest("SHA-256", rawBody));
  const message = new TextEncoder().encode(
    [requestId, userId, timestamp, bodyHash].join("\n"),
  );

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromHex(signature);
  } catch {
    return { ok: false, reason: "signature is not hex" };
  }

  for (const key of await publicKeys()) {
    if (await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, message)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no public key matched the signature" };
}
