/**
 * fal queue REST client.
 *
 * Plain fetch, no SDK — the fal JS client pulls in Node built-ins that do not
 * exist on Workers. The queue API is documented at
 * fal.ai/docs/model-apis/model-endpoints/queue.
 */

const QUEUE = "https://queue.fal.run";

export interface SubmitResult {
  request_id: string;
  response_url: string;
  status_url: string;
  cancel_url: string;
  queue_position?: number;
}

export type QueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

function headers(key: string): HeadersInit {
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

/** POST https://queue.fal.run/{model}  (?fal_webhook=… for the callback). */
export async function submit(
  key: string,
  model: string,
  input: unknown,
  webhookUrl?: string,
): Promise<SubmitResult> {
  const url = new URL(`${QUEUE}/${model}`);
  if (webhookUrl) url.searchParams.set("fal_webhook", webhookUrl);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`fal submit ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return response.json();
}

/**
 * Polling paths drop the model's sub-path.
 *
 * Submitting to `fal-ai/kling-video/o1/image-to-video` returns a status_url of
 * `…/fal-ai/kling-video/requests/{id}/status` — only the first two segments
 * survive. Constructing the URL from the full model id gives a 405, which is
 * how this was found in production. Prefer the URLs fal hands back; this is
 * the fallback when we only have a model id.
 */
export function pollBase(model: string): string {
  return model.split("/").slice(0, 2).join("/");
}

/** GET …/requests/{id}/status — the fallback when a webhook never lands. */
export async function status(
  key: string,
  model: string,
  requestId: string,
  statusUrl?: string,
): Promise<{ status: QueueStatus; queue_position?: number }> {
  const url = statusUrl ?? `${QUEUE}/${pollBase(model)}/requests/${requestId}/status`;
  const response = await fetch(url, { headers: headers(key) });
  if (!response.ok) {
    throw new Error(`fal status ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/** GET …/requests/{id} — the model-specific result object. */
export async function result<T = unknown>(
  key: string,
  model: string,
  requestId: string,
  responseUrl?: string,
): Promise<T> {
  const url = responseUrl ?? `${QUEUE}/${pollBase(model)}/requests/${requestId}`;
  const response = await fetch(url, { headers: headers(key) });
  if (!response.ok) {
    throw new Error(`fal result ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

export async function cancel(key: string, model: string, requestId: string): Promise<void> {
  await fetch(`${QUEUE}/${pollBase(model)}/requests/${requestId}/cancel`, {
    method: "PUT",
    headers: headers(key),
  });
}

/** Pull the video URL out of a result whatever shape it arrives in. */
export function videoUrl(payload: any): string | null {
  if (!payload) return null;
  const video = payload.video ?? payload.videos?.[0] ?? payload.output;
  if (typeof video === "string") return video;
  if (video && typeof video.url === "string") return video.url;
  return null;
}
