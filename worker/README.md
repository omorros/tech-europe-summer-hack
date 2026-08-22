# Lantern walkthrough Worker

Turns a route through a building into a firefighter's-eye walkthrough video —
front door to the seat of the fire — one clip per hop.

## Why a Worker

The dispatch backend runs on a laptop behind a phone hotspot with no inbound
route, so fal cannot call it back. The Worker gives fal a public HTTPS webhook
target, keeps `FAL_KEY` off the laptop, and survives the laptop being closed
mid-render.

## Why a walkthrough rather than a floor plan

Firefighters given explicit **route** information outperform those given a
survey or floor plan, because under stress they should not be planning a path
from a drawing (Safety Science 2021, replicated with 62 US/Chinese
firefighters in 2023). Knowing where the casualty is cut search time from
4m18s to 2m50s — 34% — in a 2025 *Fire* study. This renders the route itself.

## What it does not do

It does not invent a building. Each leg is generated first-frame-to-last-frame:
leg *N* **starts on the real listing photograph of room N and ends on the real
photograph of room N+1**. Both ends of every leg are evidence; only the transit
between them is synthesised. A room with no photograph is dropped from the
route rather than imagined.

Hazards are **narrated, not depicted** — a model painting flames into the wrong
room is worse than no video at all. Prompts explicitly forbid people, captions,
and any deviation from the layout in the two frames.

## Setup

```bash
npm install
npx wrangler kv namespace create SIZEUP_JOBS   # paste the id into wrangler.toml
npx wrangler secret put FAL_KEY
npx wrangler secret put WORKER_TOKEN           # shared secret for our own callers
npx wrangler deploy
# then set PUBLIC_URL in wrangler.toml to the deployed URL and redeploy,
# so fal's webhooks come back to the right origin
```

## CI/CD

`.github/workflows/worker.yml` runs typecheck + tests on every PR touching
`worker/`, and deploys on merge to `main` — but only if the tests passed. A
broken walkthrough renderer is worse than an old one during a demo.

**A repo admin must add two secrets** (Settings → Secrets and variables →
Actions). Contributors with push access cannot; the workflow fails with an
explicit message rather than a wrangler stack trace if they are missing.

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template. Scope it to the one account; it needs Workers Scripts:Edit and Workers KV Storage:Edit. |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → Workers & Pages → right-hand sidebar, or `npx wrangler whoami` |

Optionally add a repo **variable** (not secret) `WORKER_URL` pointing at the
deployed URL, and the workflow will health-check the deployment after every
release.

`FAL_KEY` and `WORKER_TOKEN` are **Worker** secrets set once with
`wrangler secret put`. They are deliberately *not* GitHub secrets and are not
redeployed by CI — the deploy step only ships code, so a rotated fal key never
needs a commit.

```bash
npm run dev        # local
npm test           # leg planning + prompt tests, no network
npm run typecheck
```

## API

### `POST /walkthrough`

```jsonc
{
  "address": "23 Larkfield Road, London SE15 4ND",
  "building_description": "mid-terrace house, two storeys, front door on the left",
  "floorplan_description": "Ground floor: hallway, lounge, kitchen at the rear…",
  "route": [                                  // entrance first, ignition last
    {"room_id": "hallway", "name": "Hallway", "floor": 0},
    {"room_id": "landing", "name": "Landing", "floor": 1},
    {"room_id": "bedroom_back", "name": "Back bedroom", "floor": 1}
  ],
  "photos": {                                 // URL or data: URI
    "hallway": "https://…/hall.jpg",
    "landing": "https://…/landing.jpg",
    "bedroom_back": "https://…/bedroom.jpg"
  },
  "hazards": ["heavy smoke on the landing"],
  "seconds_per_leg": 5                        // 3–10
}
```

Returns immediately — queue submits do not wait for renders:

```json
{ "job_id": "…", "status": "IN_QUEUE", "leg_count": 2, "poll": "https://…/walkthrough/…" }
```

### `GET /walkthrough/{job_id}`

Legs fill in as they land. `legs` is an **ordered playlist** — the console
plays them back to back, entrance first, each labelled so a crew can scrub to
one hop.

```json
{
  "status": "IN_PROGRESS",
  "progress": "1/2",
  "legs": [
    {"index": 0, "label": "Hallway → Landing", "narration": "Entry via the Hallway. Then Landing. Heavy smoke on the landing.",
     "status": "COMPLETED", "video_url": "https://v3.fal.media/…"},
    {"index": 1, "label": "Landing → Back bedroom", "status": "IN_PROGRESS", "video_url": null}
  ]
}
```

Every poll also reconciles unfinished legs against fal directly, so a lost
webhook cannot strand a job.

### `POST /webhook/fal/{job_id}/{leg}`

fal's callback. Verified by **ED25519 signature** against fal's JWKS with a
±5-minute timestamp window; it does not accept the shared token, and an
unsigned request is rejected with 401.

## Design notes

- **One KV key per leg**, never a shared mutable document. Several legs finish
  at once and a read-modify-write on one key would silently lose clips.
- **No video concatenation.** Workers have no ffmpeg; the ordered playlist is
  better anyway, because each hop is individually labelled and seekable.
- **No fal SDK.** The JS client pulls in Node built-ins Workers lack — this is
  plain `fetch` against `queue.fal.run`.
- KV is eventually consistent. Fine at demo scale; a Durable Object per job
  would be the strictly correct fix if this ever mattered.

## Which video model

Switch per request with `"model": "…"` in the body, or globally via
`VIDEO_MODEL` in `wrangler.toml`. Adapters live in `src/models.ts` because the
two models use different parameter names and different legal durations.

| | Kling O1 (default) | Veo 3.1 |
|---|---|---|
| endpoint | `fal-ai/kling-video/o1/image-to-video` | `fal-ai/veo3.1/first-last-frame-to-video` |
| price | **$0.112/s** | $0.20/s (no audio), $0.40/s (audio) |
| durations | 3–10s | 4/6/8s |
| end frame | **optional** | required |
| 2-leg route @5s | **$1.12** | $1.60 |

**Kling is the default** for three reasons: it is roughly half the price on a
shared voucher; its end frame is optional, so a route with a missing photo
still renders instead of erroring; and the 3s floor keeps a long route cheap.

**Veo is the quality option** for the one hero clip that goes in the demo
video. It's worth the extra dollar once, not eight times.

`generate_audio` defaults to **true** on Veo and doubles the price. The
adapter forces it off — we narrate the walkthrough ourselves. Never submit
raw Veo input without that flag set.

Submitting a route with a missing end frame to Veo returns a 400 explaining
the constraint and pointing at Kling, rather than letting fal reject each leg
individually.

## Buildings vary — the route length is not fixed

A flat is one hop; a large house can be ten. Nothing here assumes a room
count. Instead of a fixed clip length, the Worker **spreads a target total
(`TARGET_SECONDS`, default 30s) across however many legs the building
actually has**, snapped to whatever durations the model accepts. Short routes
get long unhurried clips; long routes get quick ones.

The effect is that cost stays roughly flat instead of climbing with the
building — on Kling:

| rooms | legs | s/leg | total | cost |
|---|---|---|---|---|
| 2 | 1 | 10s | 10s | $1.12 |
| 4 | 3 | 10s | 30s | $3.36 |
| 6 | 5 | 6s | 30s | $3.36 |
| 12 | 11 | 3s | 33s | $3.70 |
| 16 | 15 | 3s | 45s | $5.04 |

A hard `MAX_USD` ceiling (default $6) rejects anything over budget with a 402
and an explanation, rather than quietly draining a voucher that is shared with
the reconstruction lane. Veo hits it sooner than Kling — a 12-room route on
Veo is $8.80 and gets refused.

Pass `seconds_per_leg` explicitly to override the auto-scaling. Every response
includes `seconds_per_leg`, `total_seconds` and `estimated_usd`.
