/**
 * Video-model adapters.
 *
 * Kling and Veo do the same job with different parameter names and different
 * legal durations, so switching models is a config change, not a rewrite.
 *
 * Prices are per second of output, from the fal model pages (Aug 2026):
 *
 *   fal-ai/kling-video/o1/image-to-video   $0.112/s, 3–10s, end frame OPTIONAL
 *   fal-ai/veo3.1/first-last-frame-to-video $0.20/s (no audio), $0.40/s (audio),
 *                                           4/6/8s, end frame REQUIRED
 *   fal-ai/veo3.1/fast/first-last-frame-to-video  same shape, cheaper tier
 *
 * generate_audio defaults to TRUE on Veo and doubles the price. We narrate the
 * walkthrough ourselves, so every adapter forces it off.
 */

export interface LegInput {
  prompt: string;
  startImageUrl: string;
  endImageUrl?: string;
  seconds: number;
}

export interface ModelAdapter {
  id: string;
  /** Legal clip lengths, seconds. */
  durations: number[];
  usdPerSecond: number;
  /** Veo cannot generate a leg without both frames. */
  requiresEndFrame: boolean;
  build(leg: LegInput): Record<string, unknown>;
}

function snap(seconds: number, allowed: number[]): number {
  return allowed.reduce((best, option) =>
    Math.abs(option - seconds) < Math.abs(best - seconds) ? option : best,
  );
}

const KLING_O1: ModelAdapter = {
  id: "fal-ai/kling-video/o1/image-to-video",
  durations: [3, 4, 5, 6, 7, 8, 9, 10],
  usdPerSecond: 0.112,
  requiresEndFrame: false,
  build(leg) {
    const input: Record<string, unknown> = {
      prompt: leg.prompt,
      start_image_url: leg.startImageUrl,
      duration: String(snap(leg.seconds, this.durations)),
    };
    if (leg.endImageUrl) input.end_image_url = leg.endImageUrl;
    return input;
  },
};

function veo(id: string, usdPerSecond: number): ModelAdapter {
  return {
    id,
    durations: [4, 6, 8],
    usdPerSecond,
    requiresEndFrame: true,
    build(leg) {
      return {
        prompt: leg.prompt,
        first_frame_url: leg.startImageUrl,
        last_frame_url: leg.endImageUrl,
        duration: `${snap(leg.seconds, this.durations)}s`,
        resolution: "720p",
        // Off deliberately: we narrate, and audio doubles the per-second price.
        generate_audio: false,
      };
    },
  };
}

export const ADAPTERS: Record<string, ModelAdapter> = {
  [KLING_O1.id]: KLING_O1,
  "fal-ai/veo3.1/first-last-frame-to-video": veo(
    "fal-ai/veo3.1/first-last-frame-to-video",
    0.2,
  ),
  "fal-ai/veo3.1/fast/first-last-frame-to-video": veo(
    "fal-ai/veo3.1/fast/first-last-frame-to-video",
    0.2,
  ),
};

export const DEFAULT_MODEL = KLING_O1.id;

export function adapterFor(modelId: string): ModelAdapter {
  const adapter = ADAPTERS[modelId];
  if (adapter) return adapter;
  // Unknown model: assume the Kling parameter shape and say the price is
  // unknown rather than quoting a wrong one.
  return { ...KLING_O1, id: modelId, usdPerSecond: NaN };
}

export function estimateUsd(adapter: ModelAdapter, legs: number, seconds: number): number {
  return legs * snap(seconds, adapter.durations) * adapter.usdPerSecond;
}

/**
 * Per-leg clip length for a route of unknown size.
 *
 * Buildings vary — a two-room flat is one hop, a large house can be ten. A
 * fixed 5s per leg means a long route runs 55s and costs $6, dwarfing the
 * briefing it plays under. So we spread a target total across however many
 * legs there are and let the model's legal durations clamp the rest: short
 * routes get long, unhurried clips; long routes get quick ones.
 */
export function autoSeconds(
  adapter: ModelAdapter,
  legCount: number,
  targetTotalSeconds = 30,
): number {
  if (legCount < 1) return adapter.durations[0];
  return snap(targetTotalSeconds / legCount, adapter.durations);
}

export function snapDuration(adapter: ModelAdapter, seconds: number): number {
  return snap(seconds, adapter.durations);
}
