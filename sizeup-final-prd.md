# SizeUp — Final PRD (locked)

**Event:** {Tech: Europe} x VEED Hackathon, The Summer Lock-In, London, Sat Aug 22
**Team:** 4 engineers, all on Claude Max
**One-liner:** Know the building before you go through the door.

"Size-up" is the fire-service term for the rapid assessment an incident commander makes on arrival. That is what this product does.

---

## 1. Problem

Firefighters enter burning buildings blind: no floor plan, no idea where the fire started or which room the victim is in. They orient themselves by feeling through black smoke. Every second spent working out the layout is a second the trapped person does not have.

## 2. Insight

The information already exists in two places nobody connects:
1. The 999 call, full of location detail, stuck on a phone line.
2. The inside of most UK homes, photographed in historical property listings (Rightmove/Zoopla sold-prices sections keep photos and floor plans for years).

SizeUp connects them, live, during the call.

## 3. What it does (end-to-end flow)

1. Caller opens the /phone page and taps Call 999. Mic audio streams to our server.
2. Dispatch console shows an incoming call; operator answers; transcript streams in live (OpenAI realtime transcription).
3. Our Pioneer-tuned GLiNER2 extractor reads every transcript fragment in milliseconds and fires structured entities onto the hazard board mid-sentence: ADDRESS, FIRE ORIGIN, VICTIM LOCATION, HAZARD TYPE, EXITS.
4. The moment the ADDRESS entity lands, the H agent launches: it searches the Rightmove sold-prices section for the postcode, finds the matching house, opens the listing, and extracts interior photos plus the floor plan. Its own screenshots stream into the console as a live agent cam.
5. OpenAI reads the floor plan and photos into a room graph (rooms, doors, windows, entry points) and matches photos to rooms.
6. fal (Hunyuan World image-to-world) reconstructs the critical rooms into explorable 3D scenes; hazards are pinned at real angles.
7. OpenAI plans the safest entry-to-victim route, drawn on the floor plan.
8. A 30-second crew briefing video is generated with the VEED model hosted on fal.
9. Living incident picture: radio updates typed into the feed ("flashover in kitchen, rear exit blocked") are parsed by the same GLiNER2 extractor; pins move and the route replans in real time.

By the time the caller hangs up, the crew already knows the house.

## 4. Tech stack

- **Frontend:** Next.js (App Router) + Tailwind. Three routes: `/` landing, `/phone` caller, `/console` dispatch.
- **Backend:** Python + FastAPI. WebSockets for audio streaming (phone → server) and event broadcast (server → console). All AI orchestration lives here.
- **Agent executor:** Playwright (Python) driving a Chromium instance; Holo decides actions from screenshots.
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

VEED counts via its models hosted on fal. Tavily is cut; single plan-B use only if Rightmove search blocks the agent (search "address + Rightmove", hand the URL to the agent).

## 6. Compliance (from the manual)

- Team max 5 (we are 4). Submit by 19:00. Demos 20:00, awards 20:45.
- Min 3 partner technologies from Resources: we use 4 (H, OpenAI, fal, Pioneer). Compliant even before the VEED question.
- Project newly created at the hackathon; boilerplates allowed. Pre-event work stays at boilerplate level: repo scaffold, keys, model experiments, prompt tests. No product features before Saturday.
- Submission: 2-minute video (Loom or similar) with solution explanation + live walkthrough; public GitHub repo with README, setup instructions, and documentation of all APIs/tools.
- Stage 1 judging: creativity, technical complexity, bonus for partner tech use → 5 finalists. Stage 2: 5-minute live presentation → top 3.

## 7. Prize targets

1. Open Innovation finalist → top 3 (main goal)
2. fal side challenge, $1000 credits: gen media must be the main feature and it is (reconstruction). Declare in submission.
3. Fastino side challenge, 500 euros: fine-tuned GLiNER2 replacing an LLM call, their exact brief. Declare in submission.

## 8. Build plan and roles

- **Eng 1 — Agent:** Playwright harness + Holo loop. Rightmove sold-prices search → listing → gallery + floor plan extraction. Screenshot stream to console.
- **Eng 2 — Media:** fal pipeline (image-to-world per key room), web viewer with hazard pins, briefing video via VEED-on-fal.
- **Eng 3 — Intelligence:** realtime transcription pipe, GLiNER2 via Pioneer (synthetic data → fine-tune → deploy), room graph + route planner (OpenAI).
- **Eng 4 — Product:** landing, /phone, /console UI, WebSocket plumbing, integration, golden-property prep, Loom video, README, submission form.

Integration checkpoints every 90 minutes. Integration freeze 17:30.

## 9. Day-of timeline

- 09:30 arrive, redeem all codes, confirm VEED question on Discord
- 10:00 opening (team formed, skip matchmaking)
- 10:30–12:30 walking skeleton: fake call file → hardcoded hazards → cached reconstruction → route drawn. End-to-end by lunch.
- 12:30–15:30 real pipeline: live mic streaming, live extraction, live agent, real fal calls
- 15:30–17:00 living-incident updates, briefing video, polish
- 17:00–18:30 record Loom, finish README/docs
- 18:30–19:00 submit with buffer
- 19:00–20:00 rehearse the 5-minute live demo

## 10. Demo script (5-minute finalist slot)

Setup: dispatch laptop projected, teammate with phone stands visible to the room. Hotspot networking. All demo assets for the golden property pre-generated as fallback.

1. (0:00) Landing page on screen. "Firefighters enter burning buildings blind. But the inside of almost every UK home is already on the internet. We built SizeUp."
2. (0:30) Teammate taps Call 999 on the phone and speaks, panicked: address, mum in the back bedroom, fire in the kitchen. Room hears it live.
3. (0:45) Console: incoming call answered, transcript streaming, hazard entities firing mid-sentence. Point at ADDRESS lighting up: "that entity just launched our agent."
4. (1:15) Agent cam: Holo searching Rightmove sold prices, finding the house, opening the gallery, pulling the floor plan. Narrate actions.
5. (2:15) Room graph labels itself; reconstruction loads ("reconstructing…" state, cached result from the same property swaps in); hazard pins drop; route draws from front door to victim.
6. (3:15) Briefing video plays: 30 seconds, dispatch-officer avatar, captions.
7. (3:45) Radio update typed: "flashover in kitchen, rear exit blocked." Pins move, route replans live.
8. (4:15) Close: "By the time the caller hung up, the crew had already walked through the house. Every second of orientation we save is a second closer to the person inside." Q&A.

2-minute Loom = the same flow, screen-recorded in one take with voiceover.

## 11. Honest-answers bank (judge Q&A)

- Accuracy: it is a briefing aid, not ground truth; layouts change after listings. The crew treats it as prior knowledge, not gospel.
- Coverage: millions of UK homes have historical listings; roadmap is council planning portals (public blueprints) and insurer data.
- Why a fine-tuned small model: radio chatter is a continuous stream; millisecond CPU inference and per-utterance cost make an LLM call the wrong tool. We have Pioneer's eval table.
- What was cached in the demo: the reconstruction result (generated an hour earlier by the same pipeline on the same property) swaps in after the real call fires. Everything else is live.

## 12. Risks and fallbacks

- Rightmove blocks/CAPTCHAs the agent → plan B: one Tavily search returns the listing URL, agent takes over from there. Plan C: locally mirrored listing page, stated honestly.
- Reconstruction quality → golden property selected from 5+ pre-tested listings; cached outputs ready.
- Mic capture glitches on stage → hidden fallback button in console replays the pre-recorded call through the identical pipeline.
- Venue wifi → own hotspot, backend local.
- fal latency → all demo media pre-generated; live generation only for the radio-update replan, which is text-only and fast.
- Time overrun → cut order: briefing avatar (use plain captioned video), living updates (static briefing still demos), full-house reconstruction (one room is enough).

## 13. Pre-event checklist (boilerplate scope only)

1. Keys: Portal-H, fal (+voucher), OpenAI (email code), Pioneer onboarding. Slack/DM Abai re: rate limits.
2. Test Hunyuan World on 5+ real sold listings; pick golden property + backup; cache outputs.
3. Run the H quickstart loop once end-to-end on any site.
4. Repo scaffold: Next.js app with the three empty routes, FastAPI app with WebSocket echo, Playwright installed, README skeleton, empty pipeline modules.
5. Record the fallback 999 call audio; write the caller script for the live performance.
6. Buy/borrow nothing: two laptops + one phone + hotspot is the full hardware list.
7. Discord: confirm VEED counts toward the tech minimum and the boilerplate interpretation.
