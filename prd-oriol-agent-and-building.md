# SizeUp, Oriol's PRD: H agent + building intelligence

**Lane:** everything from an address to a navigable model of the house. The agent, the room graph, the 3D reconstruction.
**Event:** {Tech: Europe} x VEED Hackathon, The Summer Lock-In, London, Sat Aug 22. Submit 19:00, demos 20:00.
**Read with:** `sizeup-final-prd.md` (master). Sections 0 and 3 below are byte-identical in all three lane PRDs. If you change section 3, tell Mykyta and Bill in the same minute.

---

## 0. Shared context

**One-liner:** Know the building before you go through the door.

"Size-up" is the fire-service term for the rapid assessment an incident commander makes on arrival. That is what this product does.

**Problem:** firefighters enter burning buildings blind. No floor plan, no idea where the fire started or which room the victim is in. They orient by feeling through black smoke, and every second spent working out the layout is a second the trapped person does not have.

**Insight:** the information already exists in two disconnected places. (1) The 999 call, full of location detail, stuck on a phone line. (2) The inside of most UK homes, photographed in historical property listings, since Rightmove/Zoopla keep sold-price photos and floor plans for years. SizeUp connects them live, during the call.

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

### 1a. Exterior approach (`backend/building/approach.py`)

Build this first. It is the smallest real thing in the whole project and it is the demo's insurance policy: if Rightmove blocks the agent, this panel still fills with live data from the real call.

- Google Maps, one key, three surfaces: Geocoding (address → lat/lng), Street View Static (the building), Maps Static satellite (the plot, the rear, parking). Call the free Street View **metadata** endpoint first: it tells you whether imagery exists at that location before you spend a request, and it gives you the true panorama location, which is often a few metres off the geocode.
- Pull Street View at several headings so the front elevation is actually in frame: compute the heading from the panorama location toward the geocoded point, then take that plus a spread either side. A view of the neighbour's hedge is worse than no view.
- OpenAI vision reads the images into an `Approach`: building type (terraced, semi, flat above shop), storey count, which side the front door is on, gated or obstructed access, whether there is rear access, where an appliance can park, anything that looks like a hydrant or a standpipe.
- Emit `approach.ready`. Set `coverage: false` and still emit if Street View has nothing, so Mykyta can render an honest empty state instead of a spinner that never resolves.
- Budget: Geocoding, Street View Static and Maps Static all sit under one billing-enabled key. Free monthly quota covers a hackathon many times over, but the key needs billing switched on, so make it in the first hour or the feature is dead.

### 1b. The H agent (`backend/building/agent.py`)

The demo's centrepiece and the riskiest thing in the build. Get it working before you touch anything else.

- Playwright (Python) driving Chromium, Holo deciding actions from screenshots. Loop: screenshot → action → execute → repeat.
- H Company: Portal-H key, free tier, model `holo3-1-35b-a3b`, OpenAI-compatible API at `base_url=https://api.hcompany.ai/v1/`. Docs at hub.hcompany.ai/computer-use-agents/introduction (the manual's link has a typo). Ask Abai about rate limits and 122B access early, not at 15:00.
- Task: given an address, search the Rightmove sold-prices section for the postcode, identify the matching house, open the listing, extract the interior photo gallery and the floor plan image.
- Emit `agent.step` on every loop iteration with the action, the model's reasoning line, and a screenshot URL. This is the agent cam Mykyta renders and it is the single most impressive thing in the demo, so make the steps narratable: short, human-readable action descriptions, not raw JSON.
- Emit `agent.artifacts` when done. Write images to a local static dir the backend serves.
- Hard timeout per run with a clean `status` error, plus a cached-artifacts path for the golden property.

### 1c. Floor plan → room graph (`backend/building/rooms.py`)

- OpenAI vision on the floor plan image: rooms with names, approximate polygons in floor-plan pixel coordinates, doors, windows, external entry points.
- Photo-to-room matching across the gallery, output as `photo_room_map`.
- Coordinate space rule: everything downstream (Bill's route waypoints, Mykyta's pins) is in floor-plan pixel coordinates, origin top-left, same image Mykyta renders. Publish the image dimensions in the `RoomGraph` emission so nobody guesses.
- Emit `rooms.graph`.

### 1d. Reconstruction (`backend/building/reconstruct.py`)

- fal Hunyuan World 1.0 image-to-world, roughly $0.30 a request, explorable scene output. Voucher `techeuropexfal-london` ($25). **Shared budget with Bill's briefing video, so agree a spend split and cache aggressively.**
- Input: one photo per critical room (the room with the victim, the room with the fire, the entry room). Output: `Scene` with a viewer URL, a thumbnail, and hazard pin coordinates.
- Pins: place hazard entities at real angles in the scene, keyed to `entity_type`.
- Pre-generate and cache every scene for the golden property before the day. On the day, the live call fires the real pipeline and the cached result swaps in. We state this honestly in the Q&A.

You also own the fal side-challenge argument in the submission: reconstruction is the main feature, not a garnish.

### Why all four sit in one lane

Everything here is downstream of one input, the ADDRESS entity, and nothing here needs the transcript again. Approach and agent fire in parallel off the same address; rooms consume the agent's artifacts; reconstruction consumes rooms. One person owns the whole outside-to-inside chain, which is why the interfaces you export are so thin.

## 2. What you do not own

- Transcript, transport, and anything rendered (Mykyta).
- Entity extraction, route planning, briefing video (Bill).

You consume exactly one thing from Bill: the ADDRESS entity. You hand Bill the room graph and the approach. Do not plan the route yourself, even when it looks trivial from where you are sitting, and in particular do not pick the entry point in `approach.py`: report what you see on the street, let Bill's planner weigh it against the fire origin.

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

- **10:30–11:00** Google Maps key with billing enabled, then stub all four functions returning cached golden-property data so Mykyta's skeleton is end-to-end by lunch.
- **11:00–11:45** approach module for real. Geocode → metadata → Street View headings → satellite → vision read → `approach.ready`. This is the quickest real panel on the board and it gives Mykyta something live to design against before lunch.
- **11:45–14:30** real agent: Rightmove sold-prices search → listing → gallery + floor plan, with `agent.step` streaming. This window is the riskiest in the project; if it slips, say so at the 14:00 checkpoint rather than at 16:00.
- **14:30–15:15** real room graph from the real floor plan, photo-room matching.
- **15:15–16:15** live reconstruction on one room, cached scenes for the rest.
- **16:15–17:30** hardening: timeouts, retries, cache fallbacks. Freeze at 17:30.
- **17:30 on** write your README section (H setup, fal setup, the two API surfaces you use) and hand it to Mykyta.

## 5. Definition of done

- Cold run from an address string produces an approach assessment, streaming agent steps, a floor plan, a gallery, a room graph, and at least one scene, with no manual intervention.
- Approach emits inside a few seconds of the ADDRESS entity, well before the agent finishes. If it is not visibly first on the console, it is not doing its job.
- Every stage degrades to the cached golden-property result instead of hanging.
- The agent cam is legible to a stranger watching for 60 seconds.

## 6. Risks and fallbacks

- No Street View coverage at the golden property → checked in advance, which is now a hard criterion for picking it. Metadata endpoint means we know before we ask, and `coverage: false` renders honestly.
- Google key without billing enabled returns an error image rather than an obvious failure, so smoke-test one real request end to end before you build on it.
- Rightmove blocks or CAPTCHAs the agent → plan B: one Tavily search returns the listing URL and the agent takes over from there. Plan C: locally mirrored listing page, stated honestly on stage. Decide plan B by 14:30, not on stage.
- Holo rate limits on the free tier → ask Abai at 09:30, cap concurrent runs at one, cache every screenshot.
- Reconstruction quality → golden property picked from 5+ pre-tested listings, cached outputs ready.
- fal latency → all demo media pre-generated; nothing generative is on the critical path except Bill's text-only replan.
- fal budget → $25 voucher shared with Bill. Track spend, do not discover the ceiling at 16:00.

## 7. Demo obligations

Minutes 1:15–3:15 are yours: the approach panel landing first ("that is the actual building, that is the door they are going through, there is no rear access"), then the agent cam narration, the room graph labelling itself, and the reconstruction swapping in with the pins dropping. Rehearse the narration, it is the technical-complexity score.

## 8. Setup checklist (first hour)

Keys: Portal-H, fal + voucher, and a Google Maps key with billing enabled (Geocoding, Street View Static, Maps Static all on the same key). Run the H quickstart loop once end to end on any site. Golden property must now satisfy three tests: good Street View coverage, a floor plan in the listing, and a decent Hunyuan World result. Pick a backup that passes all three too, and cache every output.
