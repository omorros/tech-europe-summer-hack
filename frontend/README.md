# Frontend — what it is and how to wire it to the backend

Companion to `../docs/frontend-integration.md` (Bill's notes, backend → frontend).
This is the other direction: what exists on the frontend today, where the
seams are, and exactly what must change when the real lanes land.

The UI talks to FastAPI over `/ws/console` and `POST /incident`. If the
backend is down, a scripted timeline still replays a fabricated 999 call
against the same event shapes (press **R**). Surfaces that are still
fabricated stamp SYNTHETIC; that stamp drops the moment a surface carries
live lane data.

```bash
cd frontend && npm install && npm run dev     # http://localhost:3000
# FastAPI must be on :8000, or set NEXT_PUBLIC_BACKEND_URL
```

---

## 1. The four routes

| Route | What it is |
|---|---|
| `/` | Address entry. Typing an address and submitting opens the console. |
| `/phone` | The caller's handset. Big **Call 999**, cue cards to read aloud on stage, call timer. |
| `/console` | The working screen during the call: left tab rail, one attachment open at a time. |
| `/video` | The crew brief with the screen; attachments in a corner pop-up on top of it. |

`/console` and `/video` live in the `app/(incident)/` route group. Its layout
holds the run, so navigating between them **does not** restart or lose the
incident. `/` and `/phone` sit outside it.

When `briefing.ready` lands, `/console` pushes to `/video` **once per run** —
the flag lives in the provider, not the page, because the page unmounts on
navigation. Going back to the console deliberately sticks.

**Press `R` anywhere** to replay the recorded call with no phone involved.
This is the PRD's hidden fallback and it is a first-class path, not an
afterthought — it is also the only thing that works if the mic is refused on
stage.

---

## 2. The one seam: `lib/bus.ts`

Everything the UI renders arrives as a `BusEvent`. `connectBus` opens
`/ws/console` on the FastAPI process (same-origin on the Cloudflare Worker,
`localhost:8000` in `next dev`). BroadcastChannel remains as a same-device
fallback when the socket is down.

```ts
export function connectBus(handler: (event: BusEvent) => void): () => void
export function subscribeBusStatus(handler: (open: boolean) => void): () => void
```

### The two envelope fields, and why the socket can drop safely

The server adds `seq` (monotonic per process) and `boot` (which process) to the
locked `{type, ts, payload}`. On reconnect it replays its recent history, so
without dedupe a dropped socket would print the whole call a second time.
`bus.ts` keeps the highest `seq` it has applied and ignores anything at or
below it, and forgets that number when `boot` changes, because a restarted
backend counts from one again.

Reconnect backs off 0.5s → 10s. `subscribeBusStatus` is what drives the
console's **Live bus / Local replay** line, so that label tracks the actual
socket rather than the last thing that happened to work.

### Where the events land

`lib/useIncident.ts` is a reducer over `BusEvent`. It already handles all
eleven locked event types. `lib/incident-context.tsx` runs it and exposes
`{ state, started, start, handedOver }` to both routes.

`lib/timeline.ts` is **the fake**. Delete it, or keep it behind the `R` key as
the demo fallback — that is its real value. Nothing else imports it except
the provider's `start()`.

---

## 3. Contract deltas (now rendered)

These were the first work of the merge. How they land:

### 3.1 `Route.waypoints[0].room_id` is `null` (the kerb)

`lib/types.ts` says `room_id: string | null`. `FloorPlan` keeps the kerb off
the floor split (it is not floor 0), draws the segment from the plan edge to
the entry door, and labels **Kerb** and **Entry** as two marks.

### 3.2 The floor plan's coordinate space comes from the graph

When `rooms.graph` publishes `floorplan_width` / `floorplan_height`, the
viewBox is `0 0 width height`. The fabricated demo timeline still uses the
old hardcoded viewBox because that plan has no published size.

### 3.3 The brief is a playlist, not a talking head

`Briefing.video_url` is an empty string by design. `/video` plays Worker
`legs` (muted, advance on `ended`) when they exist; otherwise it renders
`briefing.lines`. `PARTIAL` is labelled. The `coverage` block ("1 of 4 rooms
photographed") is shown so a short walkthrough does not read as a complete
tour.

### 3.4 `briefing.lines` is the primary briefing surface

Each line is a `.fact` row with a quieter `source` column (`call` | `street`
| `listing` | `plan`). `listing` and `plan` render weaker than `call`/`street`.

### 3.5 The `extract` stage fires on every transcript fragment

`StatusLine` prints the Pioneer latency string (`GLiNER2 fine-tuned · 41ms`)
through a leading-edge throttle: the first message shows at once, then at most
one update per 250ms. A plain debounce would stay blank for exactly as long as
partials kept arriving, which is when the badge matters most.

---

## 4. Imagery: real files, plates as the fallback

Every image is an authored SVG drawn in the record's own grammar rather than a
grey box, so the composition is real while the pixels are not. Those plates are
now the **fallback**, not the default: `components/StaticImage.tsx` draws the
file from the backend's `/static` mount and falls back to the plate.

| Plate | Now backs |
|---|---|
| `ElevationPlate` | `approach.streetview[n].url` (Street View Static) |
| `PlotPlate` | `approach.satellite_url` (Maps Static) |
| `PhotoPlate` | `artifacts.photos[n].url` (listing gallery) |
| `ReconstructionFilm` | the Worker's walkthrough legs (§3.3) |

The fallback is not theoretical: `backend/.gitignore` excludes
`static/approach/`, so on a fresh clone the cached `approach.json` points at
Street View frames that are not on disk. Those 404s used to render as the
browser's broken-image icon on a projected console.

`FloorPlan.tsx` is **not** a placeholder — it renders the real `RoomGraph`,
route and pins, in the graph's own coordinate space (§3.2).

`SyntheticStamp` stays on anything still fabricated and is hidden whenever the
console is live. It is load-bearing for the honesty argument, not decoration.

---

## 5. How the console behaves (so you don't "fix" it)

**Attachments auto-open.** When something becomes ready it opens itself —
unless the operator chose something in the last 8 seconds, in which case
their choice holds and the new arrival gets a red **New** mark instead
(`lib/useAutoFollow.ts`). This is deliberate: the product's claim is that the
building assembles itself while the operator keeps talking. A purely manual
panel makes the assembly invisible and turns the demo into browsing.

**One attachment at a time**, on both routes. Number keys `1`–`4` reach them
directly; `Escape` closes.

**Pending states never spin.** Each attachment states what is missing and
which lane owes it ("The agent is still inside the listing"). A panel must
render truthfully when its event never arrives — no lane may block another.

**The radio field is an input to the run, not a note.** What you type goes up
the console socket (or `POST /radio` if it is down), through the same extractor
as the call, and replans the route and rewrites the crew card. Try "flashover
in the kitchen, rear exit blocked".

**The record shows extracted lines plus whatever is printing right now.**
That second half matters: transcript partials print in carbon grey and strike
to solid ink on `is_final`, with entities stamped into the line where they
were said. Filter that out and the live-arrival beat disappears.

---

## 6. Design system

`../DESIGN.md` is the full record. The three rules most likely to be broken
by accident:

- **Colour reports facts.** Red = incident state. Hi-vis yellow = the
  operator's own actions. Nothing else is coloured, ever.
- **Never colour alone.** Every state carries a drawn mark or a word too.
  Red/green is the exact pairing colourblind viewers lose, and these are
  life-safety states.
- **Two type sizes, no middle.** Record size and display size. Rank comes
  from weight, case, reversal and rule. The 11px margin size is mechanics and
  must never carry prose.

Radius is 0 everywhere. Circles mean something specific when they appear.

---

## 7. Environment

```bash
# frontend/.env.local
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000   # or https://<tunnel>.trycloudflare.com
```

One variable. The WebSocket URL is derived from it (`http` → `ws`), and an
empty value means same-origin, which is what the Cloudflare build wants — the
Worker proxies to `BACKEND_ORIGIN`. A localhost value baked into a laptop build
is ignored on a deployed hostname, otherwise every deploy from a dev machine
would ship a console pointing at the operator's own laptop.

`?backend=https://…` overrides both and persists in localStorage, which is the
quickest way to point a phone on the venue wifi at your tunnel.

The Worker token stays in the **backend's** env. It must never reach a
`NEXT_PUBLIC_` var — that ships it to every client.

---

## 8. Layout of the code

```
app/
  layout.tsx              fonts, direction contract
  page.tsx                / address entry
  phone/page.tsx          /phone caller handset
  (incident)/
    layout.tsx            IncidentProvider — holds the run across both routes
    console/page.tsx      /console
    video/page.tsx        /video
  globals.css             the entire visual system
components/
  attachments.tsx         one definition of the four attachments, read by both routes
  LogRoll.tsx             the incident record
  FloorPlan.tsx           real RoomGraph renderer
  RoomsGallery.tsx        room thumbnails → one room fills the sheet
  StaticImage.tsx         a backend file, with a plate for when it 404s
  StatusLine.tsx          call state + stage states in one line
  Sheet.tsx               the Fact row
  plates.tsx              authored imagery, used as fallback
lib/
  types.ts                mirrors backend/shared/types.py — locked
  bus.ts                  the console socket: dedupe, reconnect, BroadcastChannel
  config.ts               where the backend is (env, ?backend=, same-origin)
  api.ts                  POST /incident and POST /radio, both with deadlines
  phone.ts                the handset's /ws/phone leg
  incident-context.tsx    provider
  useIncident.ts          reducer over BusEvent
  useRunner.ts            schedules the mock timeline
  useAutoFollow.ts        arrival-driven panel opening
  timeline.ts             the fake call — keep behind R, or delete
worker.ts                 Cloudflare Worker: serves out/, proxies to the backend
wrangler.toml             asset + proxy config for the sizeup-ui Worker
```
