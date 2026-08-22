# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + Tailwind, per the locked master PRD. Three routes: `/` landing, `/phone` caller, `/console` dispatch. Backend is Python + FastAPI with WebSockets (`/ws/phone` for audio in, `/ws/console` for event fan-out); the frontend never computes derived data, it renders what the bus emits. Monorepo `frontend/` + `backend/`, public from the first commit.

## Users

Two people touch the product live, and a third audience decides whether it wins.

The dispatch operator sits at the console while a 999 call is in progress. Their job is to take the call and, without doing any extra work, watch an incident picture assemble itself: address, fire origin, victim location, hazards, the outside of the building, the inside of the building, a route. They read; they do not configure.

The caller is a panicked member of the public on `/phone`. Their entire job is one button and speaking. In the demo this is Mykyta holding a phone up to the room.

The judging panel is the audience that actually matters on 22 Aug 2026: five minutes, one projected screen, no narration crutch. A judge must be able to follow the whole story by watching the console alone.

## Product Purpose

SizeUp turns a live 999 call into a building briefing before the crew arrives. It exists because firefighters enter burning buildings blind — no floor plan, no idea which room the victim is in — while the information already sits in two disconnected places: the call itself, and historical UK property listings that keep interior photos and floor plans for years. Success is the demo statement: by the time the caller hangs up, the crew has already walked through the house.

## Positioning

Nobody joins the outside of the building to the inside of it *during the call*. Street View alone is a picture; a listing floor plan alone is a document. Fused live with a streaming 999 transcript and a hazard model, they become an approach plan and a route.

## Operating Context

Hackathon build day, {Tech: Europe} x VEED, London. Backend runs on the dispatch laptop; phone and laptop share the team's own hotspot, with venue wifi used for nothing but outbound AI API calls. The console is projected and driven by Mykyta on a laptop with mouse and keyboard — it should *read* as in-vehicle emergency kit (legible at distance, legible in a dark room and under stage light), but it is not a gloved touch console and does not need touch-first ergonomics.

The console has two phases and the layout changes between them. During the call it is a multi-panel console: live transcript, hazard board with entities popping in mid-sentence, approach panel (Street View + satellite + access notes), agent cam streaming the Holo agent's screenshots, floor plan with room labels, hazard pins and drawn route. When the briefing video is ready it goes full-bleed and everything else collapses into an expanding menu in the bottom-left corner — Street View, building plan, room photos, floor plan, transcript — opening as windows on top of the video.

Mykyta owns every pixel plus the transport layer, integration checkpoints every 90 minutes, the 17:30 freeze, and the submission. Oriol owns the agent and building reconstruction; Bill owns extraction, routing and the briefing. Their lanes reach the UI only as bus events.

## Capabilities and Constraints

The event contract in `backend/shared/types.py` and `bus.py` is locked and shipped before any lane work; changing it requires all three engineers. The console must render every event type in that table with a visible state change: `call.incoming` / `answered` / `ended`, `transcript.fragment`, `entity.extracted`, `approach.ready`, `agent.step`, `agent.artifacts`, `rooms.graph`, `scene.ready`, `route.planned`, `briefing.ready`, and `status` with `pending | running | done | error` per stage. Console sends `radio.update {text}` back.

Every panel must render a truthful pending state without its event ever arriving — a late lane must never block another panel. Transcript partials render immediately; nothing waits for `is_final`. The approach panel must handle `coverage: false` honestly (an empty state that says there is no Street View here, never a spinner that never resolves). A hidden fallback button replays a pre-recorded 999 call through the identical pipeline, and it is a first-class path, not an afterthought.

Coordinate space for every pin, polygon and waypoint is floor-plan pixel coordinates, origin top-left.

Current scope: UI only, with placeholders and mocked events. The `/phone` mock call ends by parsing the spoken address into the `/` address textbox and kicking off the whole run. Real audio, real transcription and real lane data land later against the same event shapes.

## Brand Commitments

Name: SizeUp. Line: "Know the building before you go through the door." The name is the fire-service term for the rapid assessment an incident commander makes on arrival, and the product should carry that vocabulary rather than consumer-app language.

The one binding visual constraint the team has stated: it should look like official emergency-service equipment — readable in full daylight and at night, navigable at a glance, no decoration competing with the incident picture.

## Evidence on Hand

Four PRDs in the repo: `sizeup-final-prd.md` (master, locked) plus one per lane. No code, no design tokens, no brand assets, no logo yet. No real 999 audio, no real property data, no user research — the golden property and its cached fal reconstruction are demo assets to be produced on the day, and nothing about crew adoption, accuracy or coverage may be presented as validated. The honest-answers bank in the master PRD section 11 is the agreed line on every one of those limits.

## Product Principles

The room must see it fire. Every arriving entity, every stage transition, every route draw is a visible event, because the demo is watched from a distance and judged on whether the story reads without narration.

Render, never compute. Missing data is a request to the lane that owns it, not a calculation in the frontend.

Nothing blocks anything. Panels are independent; a lane that is late leaves a truthful pending state, not a dead screen.

Legibility outranks composition. If a choice trades readability at four metres for elegance at fifty centimetres, readability wins.

Say what is unknown. No Street View coverage, no floor plan, no listing — the interface states the gap rather than spinning or implying data it does not have.

## Accessibility & Inclusion

Must stay readable in bright daylight and in a dark room without the operator adjusting anything, so contrast is a functional requirement and not a compliance box. Body text at 4.5:1 minimum, large text 3:1, verified. Never encode incident state (hazard, victim, route, stage status) in color alone — every state carries a label or shape too, since red/green is the obvious reach here and it is the exact pairing colorblind viewers lose. Reduced-motion alternatives for every animation, including the entity-arrival and route-draw moments the demo leans on.
