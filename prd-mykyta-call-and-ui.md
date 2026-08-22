# Lantern, Mykyta's PRD: call system + UI

**Lane:** the phone call, the transport layer, and every pixel the judges see.
**Event:** {Tech: Europe} x VEED Hackathon, The Summer Lock-In, London, Sat Aug 22. Submit 19:00, demos 20:00.
**Read with:** `lantern-final-prd.md` (master). Sections 0 and 3 below are byte-identical in all three lane PRDs. If you change section 3, tell Oriol and Bill in the same minute.

---

## 0. Shared context

**One-liner:** Know the building before you go through the door.

A lantern is what you carry into the dark. It does not see through walls; it lights what is in front of you — which is the honest claim for a briefing assembled from a live call and a property listing that may be years old. The fire-service term for the rapid assessment an incident commander makes on arrival is a size-up. Lantern delivers one before the crew arrives.

**Problem:** firefighters enter burning buildings blind. No floor plan, no idea where the fire started or which room the victim is in. They orient by feeling through black smoke, and every second spent working out the layout is a second the trapped person does not have.

**Insight:** the information already exists in two disconnected places. (1) The 999 call, full of location detail, stuck on a phone line. (2) The inside of most UK homes, photographed in historical property listings, since Rightmove/Zoopla keep sold-price photos and floor plans for years. Lantern connects them live, during the call.

**End-to-end flow:**

1. Caller opens `/phone`, taps Call 999, mic audio streams to the server. *(Mykyta)*
2. `/console` shows an incoming call, operator answers, transcript streams in live via OpenAI realtime transcription. *(Mykyta)*
3. Pioneer-tuned GLiNER2 reads every transcript fragment in milliseconds and fires entities onto the hazard board mid-sentence: ADDRESS, FIRE_ORIGIN, VICTIM_LOCATION, HAZARD_TYPE, EXIT. *(Bill)*
4. The moment ADDRESS lands, two things fire in parallel. **Outside in:** Google Maps geocodes the address, pulls Street View around the plot plus a satellite tile, and OpenAI reads them into an approach assessment: building type, storeys, where the front door is, gated or obstructed access, rear access, parking, hydrant hints. *(Oriol)*
5. **Inside out:** the H agent searches Rightmove sold prices for the postcode, finds the house, opens the listing, extracts interior photos and the floor plan. Its screenshots stream to the console as a live agent cam. *(Oriol)*
6. The floor plan and photos become a room graph, photos matched to rooms. *(Oriol)*
7. fal Hunyuan World reconstructs critical rooms into explorable 3D scenes, hazards pinned at real angles. *(Oriol)*
8. Safest route planned from the kerb to the victim: the approach picks the entry point, the room graph handles the interior, drawn on the floor plan. *(Bill)*
9. A 30-second crew briefing video is generated with the VEED model on fal, opening with the approach. *(Bill)*
10. Living incident picture: radio updates typed into the feed ("flashover in kitchen, rear exit blocked") go through the same extractor, pins move, route replans. *(Bill + Mykyta)*

By the time the caller hangs up, the crew already knows the house.

**Stack:** Next.js App Router + Tailwind frontend (`/`, `/phone`, `/console`). Python + FastAPI backend, WebSockets for audio in and events out, all AI orchestration server-side. Playwright + Holo for the agent. Single monorepo, `frontend/` and `backend/`, public from the first commit. Backend runs on the dispatch laptop, all devices on our own hotspot.

**Sponsor tech (4, no Tavily):** H Company (agent), OpenAI (transcription, vision, planning, synthetic data), fal (Hunyuan World reconstruction + VEED briefing video), Pioneer/Fastino (fine-tuned GLiNER2 extractor).

**Non-sponsor tech:** Google Maps (Geocoding, Street View Static, Street View metadata, Maps Static) for the exterior approach. It earns no partner-tech credit and we are already at 4 against a minimum of 3, so it is in for one reason only: knowing the outside of the building is half of a real size-up, and it is the cheapest insurance we have against the agent getting blocked.

**Prize targets:** Open Innovation top 3 (main). fal side challenge $1000 credits, gen media as the main feature. Fastino side challenge 500 euros, fine-tuned GLiNER2 replacing an LLM call. Both declared in the submission.

---

## 1. What you own

**The call system**

- `/phone` page: big Call 999 button, mic permission handling, MediaRecorder capture, chunked audio over WebSocket, call state (idle → dialling → connected → ended), visible enough on a phone screen to look real when you hold it up on stage.
- `/ws/phone`: audio ingest. Accepts binary chunks plus `call.start` / `call.end` control frames. Owns `call_id` generation.
- Realtime transcription pipe: pipe caller audio to OpenAI realtime transcription, emit `transcript.fragment` events as they arrive (partials included, marked `is_final: false`). This is the seam Bill builds on, so it goes in early and its shape does not change after 12:30.
- `/ws/console`: the event fan-out. Every event any lane emits reaches every connected console client.
- `backend/shared/bus.py` and `backend/shared/types.py`: you own these two files. Ship them at 10:30 before anything else, because Oriol and Bill both import them.

**The UI**

- `/` landing: one screen, the one-liner, enough design that the opening line of the demo lands.
- `/console` dispatch: the money screen. Incoming-call banner and answer control, live transcript column, hazard board where entities pop in mid-sentence, **approach panel** (Street View of the actual building, satellite tile, access bullets), agent cam panel streaming Oriol's screenshots, floor plan panel with room labels + hazard pins + drawn route, 3D scene viewer embed, briefing video player, radio-update text input.
- The approach panel is the first thing to fill after the address is spoken, seconds ahead of the agent, so give it the layout weight that implies: exterior on the left, interior building up on the right. It also has to render honestly when `coverage` is false, because some addresses have no Street View. An empty state that says so beats a spinner that never resolves.
- Per-stage status states: pending / running / done / error, driven by `status` events. The demo depends on the room *seeing* things fire, so make state changes loud (animation on entity arrival, "reconstructing…" spinner, route drawing in).
- WebSocket plumbing, reconnect, and the hidden fallback button that replays the pre-recorded 999 call through the identical pipeline.

**Integration and submission**

- Integration owner: you call the 90-minute checkpoints and the 17:30 freeze.
- Loom 2-minute video recording, README, submission form. Oriol and Bill each write their own README section and hand it to you.

## 2. What you do not own

- Entity extraction, route planning, briefing generation (Bill).
- The agent, the room graph, 3D reconstruction (Oriol).

You render what they emit. If an event is missing a field you need for the UI, ask for the field, do not compute it in the frontend.

## 3. Locked interfaces

Identical in all three lane PRDs. Mykyta owns the files, changes need all three of us.

### `backend/shared/types.py`

```python
Entity      = {type, value, confidence, source, ts}   # type: ADDRESS | FIRE_ORIGIN | VICTIM_LOCATION | HAZARD_TYPE | EXIT
                                                      # source: "call" | "radio"
Photo       = {id, url, caption, room_id | None}
Artifacts   = {address, listing_url, floorplan_url, photos: [Photo]}
Approach    = {lat, lng, streetview: [{heading, url}], satellite_url, building_type, storeys,
               front_door: {side, description}, access_notes: [str], obstacles: [str],
               rear_access: bool, rear_access_note, parking, coverage: bool}
Room        = {id, name, floor, polygon, doors, windows}
RoomGraph   = {rooms: [Room], adjacency: [[room_id, room_id]], entry_points: [room_id], photo_room_map: {photo_id: room_id}}
Scene       = {room_id, viewer_url, thumbnail_url, pins: [{entity_type, x, y}]}
Route       = {waypoints: [{room_id, x, y}], entry_point, rationale}
Briefing    = {video_url, captions_url, duration_s, script}
```

### Event bus

`bus.emit(type: str, payload: dict)` fans out to every console client as `{"type": ..., "ts": ..., "payload": ...}`.

| Event | Emitted by | Payload |
|---|---|---|
| `call.incoming` / `call.answered` / `call.ended` | Mykyta | `{call_id}` |
| `transcript.fragment` | Mykyta | `{call_id, seq, text, is_final, speaker}` |
| `entity.extracted` | Bill | `Entity` |
| `approach.ready` | Oriol | `Approach` |
| `agent.step` | Oriol | `{step, action, thought, screenshot_url}` |
| `agent.artifacts` | Oriol | `Artifacts` |
| `rooms.graph` | Oriol | `RoomGraph` |
| `scene.ready` | Oriol | `Scene` |
| `route.planned` | Bill | `Route` |
| `briefing.ready` | Bill | `Briefing` |
| `status` | anyone | `{stage, state, message}`. Stage: `call` \| `extract` \| `approach` \| `agent` \| `rooms` \| `scene` \| `route` \| `briefing`; state: `pending` \| `running` \| `done` \| `error` |

Console → server: `radio.update` `{text}`.

### Module entry points

Each lane exposes async functions the others call. No lane imports another lane's internals.

```python
# backend/intelligence/  (Bill)
async def on_transcript(fragment: dict) -> list[Entity]      # emits entity.extracted
async def plan_route(graph: RoomGraph, victim: Entity, hazards: list[Entity],
                    approach: Approach) -> Route
async def make_briefing(incident: dict) -> Briefing

# backend/building/  (Oriol)
async def find_approach(address: str) -> Approach             # emits approach.ready
async def find_property(address: str) -> Artifacts            # emits agent.step, agent.artifacts
async def build_room_graph(artifacts: Artifacts) -> RoomGraph # emits rooms.graph
async def reconstruct(room_id: str, photo: Photo) -> Scene    # emits scene.ready

# backend/call/  (Mykyta)
bus.emit(type, payload)
bus.subscribe(type, handler)
```

Wiring rule: ADDRESS entity → `find_approach` and `find_property`, fired in parallel, neither waits for the other. `agent.artifacts` → `build_room_graph`. `rooms.graph` + `Approach` + VICTIM_LOCATION → `plan_route` and `reconstruct`. Route + approach + entities → `make_briefing`. Mykyta wires it; the others just fire their events.

## 4. Build order

- **10:30** `types.py`, `bus.py`, `/ws/console`, three empty routes rendering. Push immediately. Oriol and Bill are blocked until this lands, so it is the first thing in the repo.
- **10:30–12:30** walking skeleton: a fake transcript file replayed through the bus, hardcoded entities on the hazard board, stub panels for approach / agent cam / floor plan / scene / video. End-to-end fake by lunch. Oriol's real `approach.ready` lands around 11:45, so that panel is the first one you can design against live data.
- **12:30–15:30** real `/phone` mic capture, real OpenAI realtime transcription, live event rendering as Oriol and Bill come online. Agent cam wired to real screenshots.
- **15:30–17:00** radio-update input, briefing player, polish, animation, the fallback replay button.
- **17:00–18:30** Loom, README, docs of every API used.
- **18:30–19:00** submit with buffer.
- **19:00–20:00** rehearse the 5-minute demo; you drive the console.

## 5. Definition of done

- Console shows every event type in the section 3 table with a visible state change, including error states and the `coverage: false` approach case.
- Fallback replay button reproduces the whole demo with no phone involved.
- Judge can watch one screen and follow the whole story with no narration.

## 6. Risks and fallbacks

- Mic capture glitches on stage → hidden fallback button replays the pre-recorded call through the identical pipeline. Test it as a first-class path, not an afterthought.
- Console laptop network hiccup → backend is local, hotspot only for outbound API calls.
- A lane runs late → every panel must render its pending state without the event ever arriving. No panel may block another.
- Transcription latency spikes → render partials immediately, never wait for `is_final`.

## 7. Demo obligations

Console projected. You drive. Judges see: incoming call answered, transcript streaming, entities firing mid-sentence, ADDRESS lighting up, agent cam narrating itself, room graph labelling, reconstruction swapping in, pins dropping, route drawing, briefing video, then the typed radio update replanning live.

## 8. Setup checklist (first hour)

Next.js app with the three routes, FastAPI app with WebSocket echo, `types.py` and `bus.py` shipped and pushed by 10:30 because the other two are blocked without them, README skeleton. Record the fallback 999 call audio and write the caller script. Confirm on Discord that VEED-on-fal counts toward the tech minimum.
