# How the pieces are wired, and how to drive them

`frontend-integration.md` was the handoff note written *before* the frontend
and backend were joined up. This is the record of how they were actually
joined, what runs where, and the two commands you need on the day.

---

## 1. The shape of it

Four processes, three of them optional:

```
  /phone  ──ws──┐
                ├──►  FastAPI (backend/server.py)  ──http──►  walkthrough Worker  ──►  fal
  /console ─ws──┘            │                                  (worker/)
                             └── H agent, Google Maps, GPT-5

  Cloudflare Worker (frontend/worker.ts)
    ├─ /                serves the exported Next.js app
    └─ /ws/ /incident /health /static/ /radio   ──►  BACKEND_ORIGIN
```

The **FastAPI process is the only thing that holds state**. Everything the
console shows arrives as a bus event over one WebSocket; nothing is fetched.
That is why the console can be closed, reopened, or opened on a second screen
mid-incident and still catch up.

### The bus is the integration

`backend/shared/bus.py` fans every lane event out to every attached console.
Two details make it survive a real demo:

- **Every frame carries `seq` and `boot`.** `seq` is a monotonic counter,
  `boot` identifies the process. A console that reconnects is replayed the
  recent backlog and drops anything whose `seq` it has already applied, so a
  dropped WiFi connection does not double-print the record. A changed `boot`
  means the backend restarted, so the console forgets the sequence entirely.
- **One bounded queue per client, drained by a single writer.** A console on a
  bad connection cannot block the lanes, and cannot grow the server's memory
  either — its queue is capped and it gets dropped rather than buffered
  forever.

`frontend/lib/bus.ts` is the other half: reconnect with exponential backoff,
dedupe on `seq`/`boot`, and a `subscribeBusStatus` hook so the UI can say
"Live bus" or "Local replay" honestly rather than pretending.

### Where each panel's data comes from

The console has four attachments, and they are deliberately fed from four
different places:

| Panel | Event | Produced by |
|---|---|---|
| Record | `transcript.fragment`, `entity.extracted` | the 999 call, from `/phone` over `/ws/phone` |
| Approach | `approach.ready` | Google Street View + satellite (`building/approach.py`) |
| Plan | `rooms.graph`, `route.planned` | the **H agent's** floor plan, read into a room graph |
| Rooms | `agent.artifacts` | the **H agent's** listing photographs |

The H agent (`backend/building/agent.py`, Holo via Portal-H) drives Rightmove
with Playwright to find the property listing, then pulls the gallery and the
floor plan. For the five vetted addresses that work is already done and
committed under `backend/cache/<slug>/`, so those load instantly; anything
else runs the agent live and falls back to the cache if it fails.

`Fact` rows carry a `source` (`call` / `street` / `listing` / `plan`) and the
UI shows it. The four layers are not equally trustworthy and the crew has to
be able to tell them apart.

---

## 2. Running the Next.js app

### On a laptop, against a local backend

```bash
# terminal 1
cd backend
uv run uvicorn server:app --host 0.0.0.0 --port 8000

# terminal 2
cd frontend
npm install
npm run dev            # http://localhost:3000
```

`frontend/.env.local` should have `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`.

### On Cloudflare

The UI Worker **is** the backend for the five warmed addresses. `/incident`,
`/ws/console`, `/ws/phone` and `/static/` are handled in a Durable Object on
the same `sizeup-ui` Worker as the Next.js export. Open
https://sizeup-ui.bill-nguyentonhoang.workers.dev, type `14 Deerdale Road`,
and the console runs without FastAPI.

FastAPI is still the laptop process for a **live** H-agent scrape of an
unknown address. Point the Worker at it only then:

```bash
cd backend && uv run uvicorn server:app --host 0.0.0.0 --port 8000
cloudflared tunnel --url http://localhost:8000
cd frontend && npx wrangler deploy --var BACKEND_ORIGIN:https://….trycloudflare.com
```

Empty `BACKEND_ORIGIN` (the default) keeps the Durable Object in charge.
`npm run deploy` from `frontend/` builds the export (and copies
`backend/cache` + listing photos into it) then ships the Worker. CI does
the same on every push to `main` that touches `frontend/` or the cache.

### Driving the app

| Where | What |
|---|---|
| `/` | type the address, press **Open console** |
| `/phone` | the caller's handset — **Call 999**, then **Next line** per cue |
| `/console` | the record, the four attachments, and a radio input |
| `/video` | the walkthrough, with the attachments as a pop-over |

Keys: **1–4** open an attachment, **Escape** closes it, **R** on the console
replays the recorded call when there is no backend to talk to. The console
hands over to `/video` by itself once the crew card lands, once per run.

The **radio input** on the console feeds text back into the same extractor
the call goes through, so "flashover in the kitchen, rear exit blocked"
replans the route and rewrites the crew card live. It goes up the open
WebSocket, or over `POST /radio` if the socket is down.

---

## 3. Testing video generation quickly

The walkthrough is **one continuous clip**: the real Street View frame of the
building, in through the front door, and on to the real photograph of the room
the fire started in. One fal generation, not several stitched together — a
crew watching the approach should see one walk, not a playlist that cuts at
every doorway. Kling O1 caps a generation at 10 seconds, so that is the
length of the walk.

### The fast loop

```bash
cd backend

# 1. plan it and print the prompt. Costs nothing, takes about a minute
#    (GPT-5 reads the floor plan to direct the shot).
uv run python -m scripts.try_walkthrough "14 Deerdale Road, London SE24 0AW" --dry

# 2. render it. ~$1.12, ~3 minutes, opens a preview when it lands.
uv run python -m scripts.try_walkthrough "14 Deerdale Road, London SE24 0AW"
```

Always run `--dry` first. It prints the route, the coverage, and the shot the
director wrote, which is where a bad render is visible *before* you pay for
it.

| Flag | Effect |
|---|---|
| `--dry` | plan only, spend nothing |
| `--secs N` | clip length, 3–10 (default 10) |
| `--legs` | the older mode: a clip per hop, more rooms photographed, but it cuts |

The five warmed addresses:

```
14 Deerdale Road, London SE24 0AW      ← best photo coverage, use this one
22 Kellett Road, London SW2 1EB
103b Norwood Road, London SE24 9AE
14b Deerbrook Road, London SE24 9BE
61b Salford Road, London SW2 4BE
```

### It only renders once

A successful render is written to `backend/cache/<slug>/walkthrough.json`,
keyed by which room the fire is in. The live console reads that file first, so
after one paid render the same address plays instantly and for free — on the
laptop, on Cloudflare, and in front of the judges. Delete the file to force a
re-render.

### Where it appears in the app

The orchestrator starts the render once the crew card is written, and
republishes `briefing.ready` with a `legs` array when the clip lands. `/video`
plays it. Until then the page shows the crew card lines, which is the honest
state rather than a spinner.

### Cost and the ceiling

`MAX_USD` on the walkthrough Worker is **$30**. A continuous 10s clip is
$1.12 at Kling O1's $0.112/s, so the headroom is really for `--legs`, which a
large house can push past the old $6 limit. The Worker refuses with a `402`
and an explanation rather than half-spending.

### Checking a render honestly

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=nb_frames walk.mp4
```

One video stream and ~10s means one take. Pull a few frames across it and
look: the first should be the real house, the last the real room, and there
should be **no people anywhere** — Kling has no `negative_prompt` field, so
"the house is completely deserted" lives in the prompt text. Saying "no
people" names people and tends to summon them; that phrasing put a
firefighter in our first render.

---

## 4. What changed from the handoff note

`frontend-integration.md` is still accurate on the bus contracts and the
honesty rules. Three things in it are now out of date:

- **The walkthrough is one clip, not a playlist per hop.** `POST /walkthrough`
  takes `continuous: true` and returns a single leg. The per-hop mode still
  exists behind `--legs`.
- **Next.js does deploy to a Worker.** The note advised against it because of
  mixed content; `frontend/worker.ts` proxies `/ws/` to the tunnel, which
  solves that.
- **There is no `NEXT_PUBLIC_WS_URL`.** The WebSocket URL is derived from the
  backend URL, so one variable configures both.
