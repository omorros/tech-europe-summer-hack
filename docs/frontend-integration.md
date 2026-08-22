# Frontend integration — for Mykyta

Everything the console and `/phone` need from my lane and from the Cloudflare
Worker. Read §1 first; it affects whether `/phone` works at all.

---

## 1. Read this before deciding where Next.js runs

There is a browser-security trap here that bites in both directions, and it
is worth ten minutes now rather than at 18:00.

**`getUserMedia` requires a secure context.** Only HTTPS origins and
`localhost` count. `http://192.168.1.5:3000` does **not** — so a phone
reaching the dev server over the hotspot by LAN IP gets the mic request
**denied by the browser**, not by the user.

**But an HTTPS page cannot open a `ws://` socket.** Mixed-content policy
blocks it. So serving the frontend from Cloudflare over HTTPS while the
FastAPI backend is `ws://192.168.1.5:8000` fails too.

So both obvious setups break:

| Setup | `/phone` mic | WebSocket | Verdict |
|---|---|---|---|
| All local, phone via LAN IP | ❌ blocked (insecure origin) | ✅ | broken |
| Next.js on Cloudflare, backend local | ✅ | ❌ blocked (mixed content) | broken |
| **Local + `cloudflared` tunnel** | ✅ | ✅ `wss://` | **works** |

### The fix

```bash
# one command, no Cloudflare account needed — prints a https://….trycloudflare.com URL
cloudflared tunnel --url http://localhost:8000
```

Point the phone and the console at that HTTPS URL. You get a secure context
(mic works), `wss://` (no mixed content), **and** `/static/...` becomes
publicly reachable, which is a bonus — see §5.

Serve Next.js from the laptop as usual (`npm run dev`), and either tunnel it
too or just open the console on the laptop itself at `localhost:3000`, which
is already a secure context.

**Risk to weigh:** a tunnel depends on the internet staying up, and the PRD
deliberately keeps the backend local. Mitigation: the console on the laptop
can always use `localhost` directly; only `/phone` on the actual phone needs
the tunnel. And the fallback replay button needs no phone at all — which is
another reason to treat it as a first-class path.

### Should Next.js deploy to the Worker?

**Not for the demo.** It is technically possible (`@opennextjs/cloudflare`),
but the backend is on your laptop, so hosting the frontend remotely buys
nothing and adds the mixed-content problem above. Worth doing *after* the
hackathon if we want a public landing page — it does not help on the day.

---

## 2. The Cloudflare Worker API

The Worker renders the walkthrough: the route through the building as video,
entrance to seat of fire, one clip per hop. Base URL is whatever
`wrangler deploy` prints; auth is a shared bearer token.

```
Authorization: Bearer <WORKER_TOKEN>
Content-Type: application/json
```

**You do not normally call this directly** — the backend does, and you render
what arrives on the bus. The endpoints are here so you can poll for progress
and build a debug panel.

### `GET /health`

```json
{ "ok": true, "model": "fal-ai/kling-video/o1/image-to-video" }
```

### `POST /walkthrough`

Returns immediately — queue submits do not wait for renders.

```json
{
  "job_id": "3fa85f64-…",
  "status": "IN_QUEUE",
  "model": "fal-ai/kling-video/o1/image-to-video",
  "leg_count": 3,
  "seconds_per_leg": 10,
  "total_seconds": 30,
  "estimated_usd": 3.36,
  "poll": "https://…/walkthrough/3fa85f64-…"
}
```

Error responses worth rendering distinctly:

| Status | Meaning |
|---|---|
| `400` | not enough photographed rooms, or a model/end-frame mismatch |
| `402` | over the `MAX_USD` ceiling — body has the estimate and the leg count |
| `401` | bad or missing bearer token |

### `GET /walkthrough/{job_id}`

Poll this. Legs fill in as fal finishes them; a lost webhook is reconciled
against fal on every poll, so a job cannot get stuck.

```json
{
  "job_id": "3fa85f64-…",
  "status": "IN_PROGRESS",
  "progress": "1/3",
  "seconds_per_leg": 10,
  "total_seconds": 30,
  "estimated_usd": 3.36,
  "legs": [
    {
      "index": 0,
      "label": "Front of the building → Entrance Hall",
      "from_room_id": "_street",
      "to_room_id": "entrance-hall-gf",
      "narration": "Entry via the Front of the building. Then Entrance Hall.",
      "status": "COMPLETED",
      "video_url": "https://v3.fal.media/files/…/leg0.mp4",
      "error": null
    },
    { "index": 1, "status": "IN_PROGRESS", "video_url": null, "…": "…" }
  ]
}
```

`status` is `IN_QUEUE` | `IN_PROGRESS` | `COMPLETED` | `PARTIAL`. **`PARTIAL`
means some legs failed** — render the ones that worked and say so; do not
wait for a completion that is not coming.

### Playing it

`legs` is an **ordered playlist**, entrance first. Play them back to back,
advancing on `ended`. Keep them **muted** — there is no audio anywhere in
this product (see §3) — and overlay the current leg's `narration` as large,
high-contrast text. Hold the last frame when the clips run out.

Each leg is individually labelled and seekable, which is deliberate: a crew
can scrub to one hop rather than rewatch the whole thing.

---

## 3. What changed in my lane's contracts

Three things differ from the PRD table. All are additive except the first.

### `briefing.ready` has no video by default

`video_url` and `captions_url` are **empty strings**. The team decided a crew
cannot hear narration over the sirens, so there is no talking head and no
audio track. **Render "no video" honestly — do not mount a dead player.**

### `briefing.ready` gained `lines`

The briefing as scannable rows, because it is read at a glance in a moving
appliance. This is now the primary briefing surface, not `script`.

```json
{
  "video_url": "",
  "captions_url": "",
  "duration_s": 21.5,
  "script": "Incident at 22 Kellett Road SW2 1EB. Terraced, 3 storeys…",
  "lines": [
    { "label": "ADDRESS",  "value": "22 Kellett Road SW2 1EB", "source": "call" },
    { "label": "BUILDING", "value": "terraced, 3 storeys",     "source": "street" },
    { "label": "CASUALTY", "value": "upstairs back bedroom",   "source": "call" },
    { "label": "FIRE",     "value": "kitchen",                 "source": "call" },
    { "label": "ENTRY",    "value": "Entrance Hall (Up)",      "source": "plan" },
    { "label": "ROUTE",    "value": "kerb → Entrance Hall → Stairs → Landing → Bedroom", "source": "plan" },
    { "label": "HAZARDS",  "value": "gas bottle in cooker; smoke in stairs", "source": "call" },
    { "label": "AVOID",    "value": "back door blocked",       "source": "call" }
  ]
}
```

**Please show `source`.** The four layers are not equally trustworthy and a
crew must be able to tell them apart:

| `source` | Means | Suggested treatment |
|---|---|---|
| `call` | The caller said it, this minute | strongest |
| `street` | Read off Street View / satellite | strong |
| `listing` | From an old property listing, possibly years stale | visibly weaker |
| `plan` | Our inference from the above | visibly weaker |

This is the honest-answer bank made visible. It is also the difference
between "decision support" and "a system that claims to know the building".

### `route.planned` — the kerb waypoint has `room_id: null`

The route starts **outside** the building, so the first waypoint is the kerb
and has no room. The locked `Waypoint` type says `str`; it should say
`str | None`. Nothing breaks at runtime, but your renderer must expect it —
draw that segment from the plan edge to the entry door.

All other coordinates are floor-plan pixels, origin top-left, on the image
whose dimensions are published as `floorplan_width` / `floorplan_height` in
`rooms.graph`. Do not guess the coordinate space.

---

## 4. `status` events from my lane

Stage `extract` fires on **every** transcript fragment, so throttle the
rendering or the badge will strobe:

```json
{ "stage": "extract", "state": "done", "message": "GLiNER2 fine-tuned · 41ms" }
```

The message names the backend that actually produced the entities — if
Pioneer fails mid-call it falls back to the keyword extractor and the badge
says so. That latency figure is server-side from Pioneer and is the number
worth putting on screen for the Fastino judges.

Stage `briefing` fires `running` → `done` or `error` around the walkthrough.

---

## 5. Two things that will surprise you

### The walkthrough is often shorter than the route

Estate agents photograph rooms they are *selling* — not hallways, landings or
stairs, which is exactly what a route walks through. On our golden property
the route passes four rooms and **only one is photographed**, so the
walkthrough is a single leg: the building's exterior, then the bedroom.

The payload carries a `coverage` block for exactly this reason:

```json
"coverage": { "route_rooms": 4, "with_imagery": 1,
              "missing": ["ENTRANCE HALL (UP)", "STAIRS (DN)", "HALLWAY / LANDING"],
              "opens_on_street_view": true }
```

**Show it** — "1 of 4 rooms photographed". A short walkthrough looks like a
complete tour otherwise, and that is the kind of quiet overclaim this product
cannot afford.

### Images going to fal are inlined, not linked

The building lane emits `/static/...` paths. fal cannot resolve those, and
the backend has no inbound route, so the backend inlines them as base64 data
URIs before sending. You do **not** need to do anything — just be aware the
walkthrough request body is a few hundred KB and that is expected.

If you set up the `cloudflared` tunnel from §1, `/static/...` becomes
publicly reachable and this workaround stops being necessary — but it stays
in place as the fallback either way.

---

## 6. Environment

```bash
# frontend/.env.local
NEXT_PUBLIC_BACKEND_URL=https://<tunnel>.trycloudflare.com   # or http://localhost:8000
NEXT_PUBLIC_WS_URL=wss://<tunnel>.trycloudflare.com          # or ws://localhost:8000
```

Derive the WebSocket URL from the page origin rather than hardcoding a
scheme, so the same build works locally and through the tunnel:

```ts
const wsBase = location.protocol === 'https:' ? 'wss://' : 'ws://'
```

The Worker URL and token live in the **backend's** `.env`
(`SIZEUP_WORKER_URL`, `SIZEUP_WORKER_TOKEN`), not the frontend — the browser
never needs the token, and putting it in a `NEXT_PUBLIC_` var would ship it
to every client.
