# Lantern, Bill's PRD: hazard intelligence + briefing media

**Lane:** everything derived from language. The Pioneer extractor, the route planner, the briefing video.
**Event:** {Tech: Europe} x VEED Hackathon, The Summer Lock-In, London, Sat Aug 22. Submit 19:00, demos 20:00.
**Read with:** `lantern-final-prd.md` (master). Sections 0 and 3 below are byte-identical in all three lane PRDs. If you change section 3, tell Mykyta and Oriol in the same minute.

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

### 1a. The Pioneer extractor (`backend/intelligence/extractor.py`)

This is a prize on its own (Fastino, 500 euros) and the thing that makes the console feel alive, because entities land mid-sentence.

- Generate synthetic 999-call transcripts and radio chatter with OpenAI, labelled for ADDRESS, FIRE_ORIGIN, VICTIM_LOCATION, HAZARD_TYPE, EXIT. Volume and variety beat polish here: accents, false starts, panicked repetition, partial addresses, corrections mid-call.
- Fine-tune GLiNER2 on Pioneer. Millisecond CPU inference is the whole argument: radio chatter is a continuous stream, so per-utterance LLM calls are the wrong tool on both latency and cost.
- `on_transcript(fragment)` runs on every fragment including partials, dedupes against what has already fired, and emits `entity.extracted` only for new or changed entities. Partials mean you will see the same entity forming across fragments, so dedupe on normalised value, not raw string.
- The same function serves radio updates with `source: "radio"`. One extractor, two inputs. Say that on stage.
- Screenshot Pioneer's eval-vs-frontier table for the submission.

### 1b. Route planning (`backend/intelligence/route.py`)

- Input: Oriol's `RoomGraph`, his `Approach`, the VICTIM_LOCATION entity, and the current hazard entities. Output: a `Route` of waypoints in floor-plan pixel coordinates, plus a one-line rationale the console can print.
- OpenAI does the reasoning: pick the entry point, then the path avoiding the fire origin and blocked exits, room-by-room.
- The entry-point choice is yours, not Oriol's. He reports what the street shows (front door side, gated access, rear access, obstacles); you weigh that against where the fire is. A front door on the fire side with usable rear access should send the crew round the back, and that is a decision only the planner can make because only the planner knows both halves.
- The route starts at the kerb, not the front door. First waypoint is the approach, so the console can draw the whole thing.
- Replan on every relevant entity change, which is what makes the radio-update moment work. Idempotent, cheap, no state left behind.

### 1c. Briefing video (`backend/intelligence/briefing.py`)

- OpenAI writes a 30-second crew briefing script from the entities, the approach and the route, in the order a crew actually needs it: address and building type, approach and access, layout, fire origin, victim location, entry plan, hazards.
- VEED model on fal renders a dispatch-officer avatar with captions. **fal budget is the $25 `techeuropexfal-london` voucher, shared with Oriol's reconstruction, so agree a split and cache.**
- Emit `briefing.ready`. Pre-generate the golden-property briefing before the day as the demo fallback.

## 2. What you do not own

- Transcription, transport, and anything rendered (Mykyta). You consume `transcript.fragment`, you never touch audio.
- The agent, room graph, approach assessment, and 3D reconstruction (Oriol). You consume `RoomGraph` and `Approach`, you never scrape and you never call Google.

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

- **10:30–11:00** stub all three functions with hardcoded golden-property output so Mykyta's skeleton is end-to-end by lunch.
- **11:00–13:00** synthetic data generation and the GLiNER2 fine-tune. Start this first: it is the only task with a training wait in it, so it should be cooking while you build the rest.
- **13:00–14:00** route planner on Oriol's real room graph and approach (his approach is real from about 11:45, the room graph lands nearer 15:00, so use his stub for that half).
- **14:00–15:00** deploy the fine-tuned extractor, wire it to live transcript fragments, tune the dedupe so the hazard board does not flicker.
- **15:00–16:00** briefing script + VEED-on-fal render, cached fallback in place.
- **16:00–17:30** the living-incident path: radio update → entity → pin move → replan. Freeze at 17:30.
- **17:30 on** write your README section (Pioneer setup, the fine-tune recipe, OpenAI and fal surfaces you use) plus the two side-challenge declarations, and hand them to Mykyta.

## 5. Definition of done

- Extractor fires correct entities on the demo call script with no misses on ADDRESS or VICTIM_LOCATION, and holds up on an unseen call script.
- Route replans within a second of a radio update.
- Route starts at the kerb and its entry point is justified by the approach, not defaulted to the front door.
- Briefing video plays in 30 seconds or under with captions.
- Fastino declaration written: what we replaced, the latency and cost argument, the eval table.

## 6. Risks and fallbacks

- Fine-tune underperforms → keep a regex/keyword extractor as the safety net behind the same interface, and be honest about it if we fall back. The interface never changes, so the swap is invisible to the other two.
- Not enough synthetic data → generate in parallel batches early; this is why it starts at 11:00.
- VEED avatar render fails or runs long → plain captioned video, no avatar. This is first in the cut order.
- fal budget → $25 voucher shared with Oriol. Agree the split at the 12:00 checkpoint.
- Route planner hallucinating impossible paths → constrain to the room graph's adjacency list, never free-form coordinates.
- Approach missing or `coverage: false` → plan from the front door and say so in the rationale. Never block the route on the exterior data.

## 7. Demo obligations

Minutes 0:45–1:15 are yours (entities firing mid-sentence, ADDRESS launching the agent), then 3:15–4:15 (briefing video, then the typed radio update replanning live). The Q&A answer on why a fine-tuned small model beats an LLM call is yours to deliver.

## 8. Setup checklist (first hour)

Keys: OpenAI credits from the Luma email, Pioneer onboarding, fal voucher shared with Oriol. Get the synthetic-data generation running before you build anything else, because it is the only task with a wait in it. Empty pipeline modules committed and stubs pushed by 11:00.
