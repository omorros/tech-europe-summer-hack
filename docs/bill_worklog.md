# Bill's lane — work log and decision record

Intelligence + media: everything derived from language, plus the walkthrough
video. Companion to `prd-bill-intelligence-and-media.md`, which is the spec;
this is what actually got built, what changed, and why.

---

## 1. What shipped

| Module | Does |
|---|---|
| `intelligence/extractor.py` | Streaming entity extraction over transcript fragments and radio chatter |
| `intelligence/pioneer.py` | Full Pioneer/GLiNER2 lifecycle client (no SDK exists — plain HTTP) |
| `intelligence/pipeline.py` | Day-of CLI: `probe → generate → label → train → evaluate → compare → bench` |
| `intelligence/route.py` | Kerb → entry point → casualty, constrained to the room graph |
| `intelligence/briefing.py` | The crew card: briefing as scannable rows with provenance |
| `intelligence/walkthrough.py` | Route + photos → walkthrough request, image inlining, coverage reporting |
| `intelligence/fal_media.py` | fal spend ledger, cache, budget ceiling, optional talking head |
| `intelligence/seed_calls.py` | 38 hand-written 999 fragments — the honest held-out eval set |
| `intelligence/golden.py` | Prefers the real committed property cache, fictional fallback |
| `worker/` | Cloudflare Worker rendering the walkthrough on fal |

Run either with no API keys:

```bash
cd backend && uv run python -m intelligence.selftest   # end to end
cd worker  && npm test                                 # 18 tests, no network
```

---

## 2. The evidence this is built on

The pitch is no longer "AI helps firefighters". It is a measured claim.

- **Kuo & Lin, *Fire*, 2025.** Firefighters searching an unfamiliar,
  smoke-obscured building for a casualty: **257.9s without the victim's
  location, 170.5s with it on a floor plan.** 87.4 seconds faster, 33.7%,
  p ≈ 4×10⁻⁷. Five of 41 teams without location information abandoned the
  search entirely.
- **Safety Science 2021, replicated 2023** (62 US and Chinese firefighters).
  Explicit **route** information beat survey/floor-plan information, because
  crews did not have to plan a path from a complicated drawing under stress.
  *This is why the product renders a walkthrough, not just a plan.*
- **First-responder navigation display:** 38% faster, 44% less distance
  travelled, 60% fewer navigation errors.
- **Why the seconds matter:** modern furnished rooms reach flashover in
  roughly 3:20–4:50 (FSRI); NIST measured untenable conditions at ~3:05–3:33.

**What we must not claim:** that saving 87 seconds causes an X% mortality
reduction. The response-time studies (Jaldell; Runefors) measure *arrival*
time, not *search* time. The defensible sentence is: *shorter response times
are associated with survival, and knowing where the casualty is cuts interior
search time by about a third.*

---

## 3. Decisions, and what changed along the way

### No audio anywhere — team decision

A crew riding to a job cannot hear narration over the sirens. So the briefing
is **on-screen text** (`lines` on `briefing.ready`) and the walkthrough is
silent.

Consequences: `video_url` and `captions_url` are empty strings by default —
the console must render "no video" honestly rather than mounting a dead
player. The talking-head path is intact behind `SIZEUP_BUBBLE_MODE` if this
reverses.

This also removed a TTS step, a portrait-image dependency, and ~$2.40 a render.

### The crew card, not prose

Because it is read at a glance in a moving appliance, the briefing is
label/value rows, each tagged with **provenance** — which matters because the
layers are not equally trustworthy:

```
ADDRESS      22 Kellett Road SW2 1EB                      [call]
BUILDING     terraced, 3 storeys                          [street]
FRONT DOOR   left — recessed door beneath a stucco arch   [street]
REAR ACCESS  none                                         [street]
CASUALTY     upstairs back bedroom                        [call]
FIRE         kitchen                                      [call]
ENTRY        Entrance Hall (Up)                           [plan]
ROUTE        kerb → Entrance Hall → Stairs → Landing → Bedroom   [plan]
HAZARDS      gas bottle in cooker; smoke in stairs        [call]
AVOID        back door blocked; rear exit blocked         [call]
```

`call` = said this minute. `street` = read off Street View. `listing` = from an
old property listing, possibly years stale. `plan` = our inference.

### The walkthrough does not invent buildings

Every leg is generated **first-frame-to-last-frame**: leg *N* starts on the
real listing photograph of room N and ends on the real photograph of room N+1.
Both ends are evidence; only the transit between them is synthesised. A room
with no photograph is **dropped, not imagined**, and `coverage` reports the
gap so the console can say "1 of 4 rooms photographed" rather than implying a
complete tour.

Prompts explicitly forbid people, captions, and any deviation from the two
frames. Hazards are **narrated, not depicted** — a model painting flames into
the wrong room is worse than no video.

### Clip length scales with the building

A flat is one hop; a large house can be ten. A fixed 5s per leg made a
12-room route 55 seconds and **$6.16**. The Worker now spreads a target total
(30s) across however many legs exist, so cost stays roughly flat:

| rooms | legs | s/leg | total | cost |
|---|---|---|---|---|
| 2 | 1 | 10s | 10s | $1.12 |
| 4 | 3 | 10s | 30s | $3.36 |
| 12 | 11 | 3s | 33s | $3.70 |
| 16 | 15 | 3s | 45s | $5.04 |

A hard `MAX_USD` ceiling (default $6) refuses anything over budget — the fal
voucher is shared with the reconstruction lane.

---

## 4. Research findings (verified live, not from memory)

### Pioneer / Fastino

- Base `https://api.pioneer.ai`, header `X-API-Key`, keys start `pio_sk_`.
  **No Python SDK exists** — do not `pip install pioneer`. Plain HTTP.
- **`GET /base-models` needs no auth.** Queried it directly: exactly **seven**
  trainable models — four GLiNER2 encoders (`base`, `large`, `multi`,
  `multi-large`, all $0.15/M) and three Nemotron decoders.
- **`nr_epochs` must be set explicitly.** The encoder default is **100**,
  which would run past the deadline. The NER guide's own example uses 5.
- **First call after a fine-tune returns `425 Too Early`** while the on-demand
  deployment cold-starts. `pioneer.warm_up()` handles it — run it before the
  demo, not during.
- **The `/inference` success shape is undocumented.** Only 4xx bodies appear in
  the docs. `parse_entities` accepts every plausible shape; `pipeline probe`
  prints the real envelope so we verify before building on it.
- **The docs contradict themselves** in three places we depend on: evaluation
  result fields (flat `f1_score` vs nested `metrics.f1`), the feedback body
  (`verdict`/`corrected_output` vs `correction`), and the generation terminal
  status (`ready` vs `complete`). The client accepts both of each.
- Rate limits: `/inference` 5,000/min, `/generate` 120/min,
  `/felix/training-jobs` 20/min. Free-plan credit amount is **not documented**.

**Gemma 4 correction.** The changelog says Gemma was sunset 2026-08-14, and
that is true for *training*. But `google/gemma-4-31B-it` and `-12B-it` are
both live for **inference** with `deprecated: false`. So the "GLiNER2 **and/or
Gemma 4**" bonus is reachable — Gemma writes the briefing script through the
same Pioneer key, meaning the whole language layer (perception *and*
generation) runs on Pioneer.

### fal / VEED

- **VEED has ten models and none of them move a camera through space.**
  Lipsync, Fabric, avatars, subtitles, background removal. Fabric 1.0 is
  *audio-driven lip-sync of a still portrait* — it cannot produce a
  walkthrough at any resolution with any prompt. Wrong tool by architecture.
- **`veed/avatars/text-to-video` has TTS built in** — text in, talking video
  out, $0.35/min versus Fabric's $0.08/s. About 13× cheaper for a 30s briefing
  and it needs no portrait image.
- **Walkthrough models** (first-frame-to-last-frame):

  | | Kling O1 (default) | Veo 3.1 |
  |---|---|---|
  | price | **$0.112/s** | $0.20/s no audio, **$0.40/s with** |
  | durations | 3–10s | 4/6/8s |
  | end frame | **optional** | required |

  Kling is the default: half the price, and its optional end frame means a
  route with a missing photo still renders. Veo is the quality option for the
  one hero clip in the demo video.
- **`generate_audio` defaults to `true` on Veo and doubles the price.** The
  adapter forces it off. Never submit raw Veo input without that flag set.
- Queue REST API at `queue.fal.run`, webhooks via `?fal_webhook=`, signed with
  **ED25519** against a JWKS with a ±5-minute replay window.

---

## 5. Compatibility with the building lane

Oriol's PR #1 merged first, so his conventions win. What had to change:

- **Import root.** His modules use `from shared import bus`; mine used
  `from backend.shared import bus`. Incompatible package roots — fine in
  isolation, broken the moment both lanes load into one app. Adopted his.
- **Removed** `backend/__init__.py` (made `backend` a regular package his
  imports don't want) and `backend/requirements.txt` (his `pyproject.toml`
  already covers every dependency I need).
- **`intelligence/config.py`** mirrors `building/config.py` and loads the same
  `backend/.env`. It deliberately does *not* import `building.config` — the
  PRD forbids importing another lane's internals, and it would drag in
  playwright and PIL for two constants.
- **My lane never loaded `.env`.** Silent failure: keys placed where his
  instructions say would have been invisible to my extractor, which would have
  quietly fallen back to the keyword net. Fixed.
- **fal cannot fetch `/static/...` URLs.** His artifacts emit server-relative
  paths, and the backend runs behind a phone hotspot with no inbound route.
  Every walkthrough leg would have failed. Images are now inlined as base64
  data URIs (~110–235 KB each).
- **`floorplan_width` / `floorplan_height`**, not my `plan_width`. My kerb
  projection was silently using a guessed canvas.
- **Kebab-case room ids and shouty names** (`bedroom-1`, `HALLWAY / LANDING`,
  `STAIRS (DN)`). The tokeniser only split on underscores.
- **`backend/.env.example`** now has a section per lane instead of one
  clobbering the other.

---

## 6. Bugs found in review, all fixed with regression tests

1. **The status badge lied after a fallback.** When Pioneer failed, the
   extractor correctly dropped to the keyword net but the "done" badge still
   read `GLiNER2 fine-tuned`. On a projected console in front of Fastino
   judges, that reads as the fine-tuned model working when it is not.
2. **A photo without an `id` key crashed payload building.** `photo["id"]` was
   unguarded across a lane boundary — one malformed photo killed the whole
   briefing.
3. **The Worker marked video-less legs COMPLETED.** fal can return
   `status: "OK"` with a null payload; the console would show a leg as done
   with nothing to play. Now `ERROR` with the reason.
4. **An unpriced model bypassed the budget ceiling.** `Number.isFinite(NaN)`
   is false, so the guard was skipped entirely — unlimited spend on a shared
   voucher. Now refused with a 400.
5. **Tied edge distances collided in a dict.** `_kerb_waypoint` keyed
   candidates by distance, so a door dead-centre silently dropped tied
   candidates. Latent rather than live, but now a deliberate tie-break.

---

## 7. Known limits — state these honestly

- **Listings do not photograph circulation.** Estate agents shoot rooms they
  are selling, not hallways and stairs — which is exactly what a route walks
  through. On 22 Kellett Road the route runs entrance hall → stairs → landing
  → bedroom and **only the bedroom is photographed**, so the walkthrough is
  one leg. Both unmapped photos in that listing are exterior facade shots, so
  this is what listings *are*, not a matcher bug.
- **The walkthrough opens on the building's exterior** to compensate — Street
  View if available, else a listing facade photo — so it starts at the kerb
  like the route does and a single-match property still has two real frames.
- **Layouts change after listings.** This is a briefing aid, not ground truth.
  The provenance tags exist so a crew can weigh each line.
- **Walkthrough quality is untested.** No `FAL_KEY` yet, so nobody has seen
  what Kling produces between two interior photos that share little visual
  context. First thing to test once the key lands — about $2.70 to compare
  Kling and Veo on the same two frames.

---

## 8. Open questions for the team

1. **`Waypoint.room_id` is typed `str`** but the kerb waypoint emits `None`,
   because the route starts outside the building. Works at runtime; the locked
   type should say so and the renderer must expect it.
2. **`static/approach/` is gitignored while `approach.json` is committed**, so
   a fresh clone has broken Street View references — affecting the approach
   panel too, not just the walkthrough.
3. **Both upstairs bedrooms are named `BEDROOM`.** "Upstairs back bedroom"
   resolves to whichever sorts first — a coin flip on which room a crew is
   sent to. Disambiguating by polygon y-position would fix it.
4. **Python ≥3.13 and `uv`** are required by `pyproject.toml` but not
   installed on my machine; my lane runs on 3.12. Someone should verify the
   combined app under the real toolchain before the integration freeze.
5. **VEED is now unused.** Four sponsor technologies remain (H, OpenAI, fal,
   Pioneer) against a minimum of three, so we are compliant — but this is the
   VEED-co-hosted hackathon. `veed/subtitles` accepts a custom SRT and could
   burn the leg text into the clips for ~$0.10/min if we want them represented.

---

## 9. Side-challenge declarations

### Fastino / Pioneer

We replaced a frontier-LLM call with a fine-tuned specialist. Extraction — a
live 999 transcript into structured hazard entities — started as an LLM call
and became a GLiNER2 encoder fine-tuned on Pioneer. That swap is why the
console can fire entities mid-sentence.

Why a small model is the *right* tool, not just the cheap one: a 999 call and
the radio chatter after it are a continuous stream, and we re-extract on every
fragment including partials — several calls per spoken sentence. Per-utterance
frontier calls are the wrong instrument at that rate on both latency and cost.

Features used: **synthetic data generation** (we have no corpus of real 999
calls and could not ethically obtain one), **auto-labelling** of hand-written
fragments covering what synthetic generation misses, **evaluation against
frontier baselines** on a held-out set that is deliberately hand-written so it
is not drawn from the training distribution, and **adaptive inference** —
every extraction returns an `inference_id`, and a dispatcher marking an entity
wrong posts a correction.

Creative GLiNER2: one forward pass returns the five hazard entities **and** a
triage classification (`persons_reported` vs `property_fire_no_persons`) —
the real UK mobilisation category that changes what gets sent. Gemma 4 writes
the briefing script through the same key.

### fal

Generative media is the product, not a garnish. The walkthrough — the thing
that turns a planned route into something a crew can watch before they go
through the door — is generated on fal, and the evidence says route
information is what actually reduces search time.

---

*Numbers from `pipeline compare` and `pipeline bench` go here once the
Pioneer key lands.*
