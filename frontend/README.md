# Frontend — what it is and how to wire it to the backend

Companion to `../frontend-integration.md` (Bill's notes, backend → frontend).
This is the other direction: what exists on the frontend today, where the
seams are, and exactly what must change when the real lanes land.

**Everything on screen right now is synthetic.** No backend call is made
anywhere. A scripted timeline replays a fabricated 999 call against the real
event shapes. Every surface stamps it SYNTHETIC.

```bash
cd frontend && npm install && npm run dev     # http://localhost:3000
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

## 2. The one seam you need: `lib/bus.ts`

Everything the UI renders arrives as a `BusEvent`. Today that is a
`BroadcastChannel` so two tabs on one machine can talk. **Replace the body of
`connectBus` with the WebSocket and every call site stays untouched.**

```ts
// lib/bus.ts — today
export function connectBus(handler: (event: BusEvent) => void): () => void
```

Sketch of the swap, using Bill's env vars and origin-derived scheme:

```ts
export function connectBus(handler: (event: BusEvent) => void): () => void {
  const base = process.env.NEXT_PUBLIC_WS_URL
    ?? `${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}`;
  const socket = new WebSocket(`${base}/ws/console`);
  socket.onmessage = (message) => handler(JSON.parse(message.data) as BusEvent);
  return () => socket.close();
}
```

Known ceiling of the current implementation, written in the file: a
`BroadcastChannel` is same-origin **and same-device**. Driving `/console`
from a real phone over the hotspot needs the real socket. Read
`../frontend-integration.md` §1 before choosing where things run — there is a
secure-context vs mixed-content trap that breaks both obvious setups.

`/phone` currently emits `call.incoming` / `call.ended` through `emitRemote`.
Once `/ws/phone` exists, that becomes mic capture over the socket and the
server owns `call_id`.

### Where the events land

`lib/useIncident.ts` is a reducer over `BusEvent`. It already handles all
eleven locked event types. `lib/incident-context.tsx` runs it and exposes
`{ state, started, start, handedOver }` to both routes.

`lib/timeline.ts` is **the fake**. Delete it, or keep it behind the `R` key as
the demo fallback — that is its real value. Nothing else imports it except
the provider's `start()`.

---

## 3. What must change when the real lanes land

These are contract deltas from `../frontend-integration.md` that the frontend
does **not** handle yet. Ordered by how badly they break.

### 3.1 `Route.waypoints[0].room_id` is `null` (the kerb)

`lib/types.ts:88` says `room_id: string`. It must be `string | null`.

`components/FloorPlan.tsx:49` does
`graph.rooms.find(r => r.id === roomId)?.floor ?? 0` — a null kerb silently
becomes floor 0. It will not crash; it will draw the wrong thing. The kerb
segment should be drawn from the plan edge to the entry door, not treated as
a room on the ground floor.

### 3.2 The floor plan's coordinate space is hardcoded

`components/FloorPlan.tsx:7` — `const VIEW = "10 60 980 420"`. That is sized
to the fabricated demo plan.

`rooms.graph` publishes `floorplan_width` / `floorplan_height`. Use them:
`viewBox={`0 0 ${graph.floorplan_width} ${graph.floorplan_height}`}`. Add
those two fields to `RoomGraph` in `lib/types.ts` first. **Do not guess the
coordinate space** — every pin, polygon and waypoint is in floor-plan pixels,
origin top-left, against that image.

### 3.3 The brief is a playlist, not a video, and has no audio

`Briefing.video_url` arrives as an **empty string** by design — no talking
head, because a crew cannot hear narration over sirens. Today `/video`
renders `ReconstructionFilm`, an authored SVG placeholder.

The real thing is the Worker's `legs` array: an ordered playlist, entrance
first. Play back to back advancing on `ended`, **muted**, with the current
leg's `narration` overlaid large and high-contrast. Hold the last frame when
the clips run out. `status: "PARTIAL"` means some legs failed — render what
worked and say so.

Also render the `coverage` block ("1 of 4 rooms photographed"). Estate agents
photograph rooms they are selling, not the hallways a route walks through, so
a short walkthrough is normal and looks like a complete tour if you stay
quiet about it.

### 3.4 `briefing.lines` is the primary briefing surface

Not `script`. Each line carries a `source`: `call` | `street` | `listing` |
`plan`. **Show the source** — the four layers are not equally trustworthy and
the whole honesty argument rests on a crew being able to tell them apart.
`call` and `street` strongest; `listing` and `plan` visibly weaker.

Add `lines` to the `Briefing` type. The existing `.fact` row (label + value)
is the right device; the source needs a third, quieter column.

### 3.5 The `extract` stage fires on every transcript fragment

`components/StatusLine.tsx` counts stage states. Unthrottled, the badge will
strobe during a live call. Throttle to ~250ms or render `extract` as a count
rather than a state.

That message also carries the Pioneer latency (`"GLiNER2 fine-tuned · 41ms"`)
— that number is worth putting on screen for the Fastino judges, and it names
the fallback keyword extractor if Pioneer dies mid-call.

---

## 4. Placeholder imagery — the replace list

Every image is an authored SVG drawn in the record's own grammar rather than
a grey box, so the composition is real while the pixels are not. All live in
`components/plates.tsx`, which opens with this list:

| Component | Replace with |
|---|---|
| `ElevationPlate` | `approach.streetview[n].url` (Street View Static) |
| `PlotPlate` | `approach.satellite_url` (Maps Static) |
| `PhotoPlate` | `artifacts.photos[n].url` (listing gallery) |
| `ReconstructionFilm` | the Worker's walkthrough legs (§3.3) |

`FloorPlan.tsx` is **not** a placeholder — it renders the real `RoomGraph`,
route and pins. Only its viewBox is wrong (§3.2).

Keep `SyntheticStamp` on anything still fabricated, and remove it the moment
a surface carries real data. It is load-bearing for the honesty argument, not
decoration.

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
NEXT_PUBLIC_BACKEND_URL=https://<tunnel>.trycloudflare.com   # or http://localhost:8000
NEXT_PUBLIC_WS_URL=wss://<tunnel>.trycloudflare.com          # or ws://localhost:8000
```

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
  StatusLine.tsx          call state + stage states in one line
  Sheet.tsx               the Fact row
  plates.tsx              authored placeholder imagery + replace list
lib/
  types.ts                mirrors backend/shared/types.py — locked
  bus.ts                  THE SWAP POINT
  incident-context.tsx    provider
  useIncident.ts          reducer over BusEvent
  useRunner.ts            schedules the mock timeline
  useAutoFollow.ts        arrival-driven panel opening
  timeline.ts             the fake call — keep behind R, or delete
```
