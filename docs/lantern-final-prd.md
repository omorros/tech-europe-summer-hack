# Lantern — Final PRD (locked)

**Event:** {Tech: Europe} x VEED Hackathon, The Summer Lock-In, London, Sat Aug 22
**Team:** 3 engineers (Mykyta, Oriol, Bill), all on Fable Max
**One-liner:** Know the building before you go through the door.

A lantern is what you carry into the dark. It does not see through walls; it lights what is in front of you — which is the honest claim for a briefing assembled from a live call and a property listing that may be years old. The fire-service term for the rapid assessment an incident commander makes on arrival is a size-up. Lantern delivers one before the crew arrives.

---

## 1. Problem

Firefighters enter burning buildings blind: no floor plan, no idea where the fire started or which room the victim is in. They orient themselves by feeling through black smoke. Every second spent working out the layout is a second the trapped person does not have.

## 2. Insight

The information already exists in two places nobody connects:
1. The 999 call, full of location detail, stuck on a phone line.
2. The inside of most UK homes, photographed in historical property listings (Rightmove/Zoopla sold-prices sections keep photos and floor plans for years).

Lantern connects them, live, during the call.

## 3. What it does (end-to-end flow)

1. Caller opens the /phone page and taps Call 999. Mic audio streams to our server.
2. Dispatch console shows an incoming call; operator answers; transcript streams in live (OpenAI realtime transcription).
3. Our Pioneer-tuned GLiNER2 extractor reads every transcript fragment in milliseconds and fires structured entities onto the hazard board mid-sentence: ADDRESS, FIRE ORIGIN, VICTIM LOCATION, HAZARD TYPE, EXITS.
4. The moment the ADDRESS entity lands, two chains fire in parallel.
5. **Outside in:** Google Maps geocodes the address; Street View Static gives us the building from the road at several headings; Maps Static gives us the plot from above. OpenAI reads them into an approach assessment: building type, storeys, which side the front door is on, gated or obstructed access, rear access, where an appliance can park.
6. **Inside out:** the H agent searches the Rightmove sold-prices section for the postcode, finds the matching house, opens the listing, and extracts interior photos plus the floor plan. Its own screenshots stream into the console as a live agent cam.
7. OpenAI reads the floor plan and photos into a room graph (rooms, doors, windows, entry points) and matches photos to rooms.
8. fal (Hunyuan World image-to-world) reconstructs the critical rooms into explorable 3D scenes; hazards are pinned at real angles.
9. OpenAI plans the safest route from the kerb to the victim: the approach decides the entry point, the room graph decides the interior path, drawn on the floor plan.
10. A 30-second crew briefing video is generated with the VEED model hosted on fal, in the order a crew needs it: approach, layout, fire, victim, entry.
11. Living incident picture: radio updates typed into the feed ("flashover in kitchen, rear exit blocked") are parsed by the same GLiNER2 extractor; pins move and the route replans in real time.

By the time the caller hangs up, the crew already knows the street, the door, and the house.

## 4. Tech stack

- **Frontend:** Next.js (App Router) + Tailwind. Three routes: `/` landing, `/phone` caller, `/console` dispatch.
- **Backend:** Python + FastAPI. WebSockets for audio streaming (phone → server) and event broadcast (server → console). All AI orchestration lives here.
- **Agent executor:** Playwright (Python) driving a Chromium instance; Holo decides actions from screenshots.
- **Exterior:** Google Maps Geocoding + Street View Static (with the free metadata endpoint to check coverage first) + Maps Static satellite, read by OpenAI vision into a structured approach assessment.
- **Realtime:** phone captures mic via MediaRecorder, sends audio chunks over WebSocket; server pipes to OpenAI realtime transcription; transcript fragments broadcast to console and fed to GLiNER2.
- **Repo:** single monorepo, `frontend/` and `backend/`, public on GitHub from the first commit (submission requires it anyway).
- **Networking:** backend runs on the dispatch laptop; both devices on our own phone hotspot. Zero dependence on venue wifi except outbound AI API calls.

## 5. Sponsor tech map (4 technologies, no Tavily)

| Tech | Role | Details |
|---|---|---|
| H Company | Hands and eyes: finds and scrapes the listing | Portal-H key, free tier, model `holo3-1-35b-a3b`. OpenAI-compatible API, `base_url=https://api.hcompany.ai/v1/`. Loop: screenshot → action → execute via Playwright. Docs: hub.hcompany.ai/computer-use-agents/introduction (manual link has a typo). Ask Abai about rate limits / 122B access. |
| OpenAI | Brain: transcription, floor plan → room graph, photo-room matching, route planning, briefing script, synthetic training data for Pioneer | Credits arrive by email via Luma account. |
| fal | Star: room reconstruction + briefing video | Hunyuan World 1.0 image-to-world (~$0.30/req, explorable scene output). VEED lipsync/avatar model on fal for the briefing video. Voucher code: techeuropexfal-london ($25). |
| Pioneer (Fastino) | Specialist: 999-call and radio-chatter hazard extractor | Fine-tune GLiNER2 on synthetic 999 transcripts (OpenAI-generated). Millisecond CPU inference is why it beats an LLM call for streaming chatter. Screenshot Pioneer's eval-vs-frontier table for the submission. |

Google Maps is deliberately outside this table. It is not a partner technology, so it earns no bonus on partner-tech use, and we are already at 4 against a minimum of 3. It is in for two reasons: exterior size-up is half of what the product claims to do, and it is the cheapest insurance we have, because if Rightmove blocks the agent the console still fills with live exterior intelligence driven by the real call.

VEED counts via its models hosted on fal. Tavily is cut; single plan-B use only if Rightmove search blocks the agent (search "address + Rightmove", hand the URL to the agent).

## 6. Compliance (from the manual)

- Team max 5 (we are 3). Submit by 19:00. Demos 20:00, awards 20:45.
- Min 3 partner technologies from Resources: we use 4 (H, OpenAI, fal, Pioneer). Compliant even before the VEED question.
- Project newly created at the hackathon; boilerplates allowed. Pre-event work stays at boilerplate level: repo scaffold, keys, model experiments, prompt tests. No product features before Saturday.
- Submission: 2-minute video (Loom or similar) with solution explanation + live walkthrough; public GitHub repo with README, setup instructions, and documentation of all APIs/tools.
- Stage 1 judging: creativity, technical complexity, bonus for partner tech use → 5 finalists. Stage 2: 5-minute live presentation → top 3.

## 7. Prize targets

1. Open Innovation finalist → top 3 (main goal)
2. fal side challenge, $1000 credits: gen media must be the main feature and it is (reconstruction). Declare in submission.
3. Fastino side challenge, 500 euros: fine-tuned GLiNER2 replacing an LLM call, their exact brief. Declare in submission.

## 8. Build plan and roles

Three lanes, one per engineer. Each has its own PRD, and each of those repeats the shared context and the locked interfaces verbatim so it can be handed to an agent on its own.

- **Mykyta, call + UI** (`prd-mykyta-call-and-ui.md`): `/phone` mic capture, audio WebSocket, OpenAI realtime transcription pipe, event bus and fan-out, landing + `/phone` + `/console` UI, all rendering and status states, integration, fallback replay, Loom + README + submission.
- **Oriol, agent + building** (`prd-oriol-agent-and-building.md`): Google Maps exterior approach (geocode → Street View → satellite → vision read), Playwright + Holo agent loop, Rightmove sold-prices search → listing → gallery + floor plan, agent-cam screenshot stream, floor plan → room graph and photo-room matching, fal Hunyuan World reconstruction with hazard pins. Owns the fal side-challenge argument.
- **Bill, intelligence + media** (`prd-bill-intelligence-and-media.md`): synthetic 999 data, GLiNER2 fine-tune on Pioneer, streaming extraction for call and radio chatter, route planning, briefing script + VEED-on-fal video. Owns the Fastino side-challenge declaration.

Shared, non-negotiable: `backend/shared/types.py` and `backend/shared/bus.py` are Mykyta's files and ship at 10:30 before any lane work, because the other two import them. The event table and module entry points in section 3 of each lane PRD are identical; changing one means telling the other two immediately. Coordinate space for every pin, polygon and waypoint is floor-plan pixel coordinates, origin top-left. The $25 fal voucher is shared between Oriol and Bill, split agreed at the 12:00 checkpoint.

Dependency order: Mykyta's bus, then Bill's ADDRESS entity → Oriol's approach and agent in parallel → Oriol's room graph → Bill's route and briefing → Mykyta renders all of it. Oriol picks no entry point and Bill calls no Google API: the exterior lane reports what the street shows, the planner decides what to do about it. Everyone ships a stub returning cached golden-property data by 11:00 so the skeleton is end-to-end before lunch.

Integration checkpoints every 90 minutes. Integration freeze 17:30.

## 9. Day-of timeline

- 09:30 doors, redeem all codes, confirm VEED question on Discord. Google Maps key with billing enabled in this window or the approach feature dies.
- 10:15 opening (pushed back from 10:00 per the Discord blast; team formed, skip matchmaking)
- 10:30–12:30 walking skeleton: fake call file → hardcoded hazards → cached reconstruction → route drawn. End-to-end by lunch. Oriol's approach module is real by 11:45, the first live panel on the board.
- 12:30–15:30 real pipeline: live mic streaming, live extraction, live agent, real fal calls
- 15:30–17:00 living-incident updates, briefing video, polish
- 17:00–18:30 record Loom, finish README/docs
- 18:30–19:00 submit with buffer (19:00 is the competition opt-in deadline, dinner follows)
- 19:00–20:00 rehearse the 5-minute live demo

## 10. Demo script (5-minute finalist slot)

Setup: dispatch laptop projected, teammate with phone stands visible to the room. Hotspot networking. All demo assets for the golden property pre-generated as fallback.

1. (0:00) Landing page on screen. "Firefighters enter burning buildings blind. But the outside of every UK building is on Street View and the inside of most UK homes is in an old property listing. Nobody has ever joined the two during the call. We built Lantern."
2. (0:30) Teammate taps Call 999 on the phone and speaks, panicked: address, mum in the back bedroom, fire in the kitchen. Room hears it live.
3. (0:45) Console: incoming call answered, transcript streaming, hazard entities firing mid-sentence. Point at ADDRESS lighting up: "that one entity just launched two things at once: Maps on the outside, an agent on the inside."
4. (1:15) Approach panel fills first, seconds after the address is spoken: the actual building on Street View, the plot from above, access read out. "That is the building. The front door is on the left, there is no rear access, the appliance parks there. The crew has never seen this house and they already know how they are getting in."
5. (1:45) Agent cam: Holo searching Rightmove sold prices, finding the house, opening the gallery, pulling the floor plan. Narrate actions. "Outside came from Maps in two seconds. Inside is an agent doing what a human would do, live."
6. (2:30) Room graph labels itself; reconstruction loads ("reconstructing…" state, cached result from the same property swaps in); hazard pins drop; route draws from the kerb, through the chosen entry point, to the victim.
7. (3:20) Briefing video plays: 30 seconds, dispatch-officer avatar, captions.
8. (3:50) Radio update typed: "flashover in kitchen, rear exit blocked." Pins move, route replans live.
9. (4:15) Close: "By the time the caller hung up, the crew had already walked through the house. Every second of orientation we save is a second closer to the person inside." Q&A.

2-minute Loom = the same flow, screen-recorded in one take with voiceover.

## 11. Honest-answers bank (judge Q&A)

- Accuracy: it is a briefing aid, not ground truth; layouts change after listings. The crew treats it as prior knowledge, not gospel.
- Coverage: millions of UK homes have historical listings; roadmap is council planning portals (public blueprints) and insurer data.
- Why a fine-tuned small model: radio chatter is a continuous stream; millisecond CPU inference and per-utterance cost make an LLM call the wrong tool. We have Pioneer's eval table.
- Isn't the exterior just Google Street View: yes, and that is the point. Street View alone is a picture; fused with a live 999 transcript, an interior floor plan and a hazard model it becomes an approach plan. No crew is going to alt-tab to Maps at 3am, and no existing tool joins the outside of the building to the inside of it during the call.
- Why Google Maps when it is not a partner: it is not for the scoring, it is because a size-up starts at the kerb. We hit the partner minimum with four sponsor technologies before Maps is counted at all.
- What was cached in the demo: the reconstruction result (generated an hour earlier by the same pipeline on the same property) swaps in after the real call fires. Everything else is live.

## 12. Risks and fallbacks

- Rightmove blocks/CAPTCHAs the agent → plan B: one Tavily search returns the listing URL, agent takes over from there. Plan C: locally mirrored listing page, stated honestly.
- Reconstruction quality → golden property selected from 5+ pre-tested listings; cached outputs ready.
- Mic capture glitches on stage → hidden fallback button in console replays the pre-recorded call through the identical pipeline.
- Venue wifi → own hotspot, backend local.
- No Street View coverage at the golden property → coverage is now a selection criterion for the golden property and its backup, and the free metadata endpoint tells us before we spend a request. If coverage is genuinely absent the panel says so rather than spinning.
- Google key without billing enabled → fails as an error image rather than an exception, so smoke-test one real request before building on it.
- fal latency → all demo media pre-generated; live generation only for the radio-update replan, which is text-only and fast.
- Time overrun → cut order: briefing avatar (use plain captioned video), then the approach's AI reading (keep the raw Street View image, which still carries the moment), then living updates (static briefing still demos), then full-house reconstruction (one room is enough). The approach panel itself is never cut: it is cheap and it is our hedge against the agent.

## 13. Setup checklist (first hour, on the day)

1. Keys: Portal-H, fal (+voucher), OpenAI (email code), Pioneer onboarding, Google Maps with billing enabled. Slack/DM Abai re: rate limits.
2. Test Hunyuan World on 5+ real sold listings; pick golden property + backup. Both must pass three tests: Street View coverage, a floor plan in the listing, a decent reconstruction. Cache outputs.
3. Run the H quickstart loop once end-to-end on any site.
4. Repo scaffold: Next.js app with the three empty routes, FastAPI app with WebSocket echo, Playwright installed, README skeleton, empty pipeline modules.
5. Record the fallback 999 call audio; write the caller script for the live performance.
6. Buy/borrow nothing: two laptops + one phone + hotspot is the full hardware list.
7. Discord: confirm VEED counts toward the tech minimum and the boilerplate interpretation.
