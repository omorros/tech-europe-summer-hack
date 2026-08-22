# SizeUp — intelligence + media lane (Bill)

Everything derived from language: the hazard extractor, the route planner, the
crew briefing. Hand this section to Mykyta for the submission README.

## Run it with no keys at all

```bash
python3 -m backend.intelligence.selftest
```

Replays a scripted 999 call through the real pipeline — including partial
fragments the way the realtime transcriber emits them — plans a route on the
golden room graph, replans after a radio update, and prints the briefing. No
API keys, no network, no dependencies. This is the walking skeleton the other
two lanes integrate against.

## The Pioneer path

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
export PIONEER_API_KEY=pio_sk_...        # pioneer.ai > Settings > API Keys (shown once)

.venv/bin/python -m backend.intelligence.pipeline probe      # do this FIRST
.venv/bin/python -m backend.intelligence.pipeline generate   # synthetic datasets (start early)
.venv/bin/python -m backend.intelligence.pipeline label      # annotate our hand-written set
.venv/bin/python -m backend.intelligence.pipeline train      # LoRA fine-tune on GLiNER2
.venv/bin/python -m backend.intelligence.pipeline compare <job_id>   # vs frontier baselines
.venv/bin/python -m backend.intelligence.pipeline bench <job_id>     # our own latency numbers
```

`probe` is first for a reason: the success shape of `POST /inference` is not
documented anywhere on docs.pioneer.ai, so we print the raw envelope and
confirm the parser against a live call before building on it.

Going live is one environment variable — `PIONEER_MODEL_ID=<training-job-uuid>`
swaps the fine-tuned checkpoint in behind the same interface. Without it we run
zero-shot GLiNER2; without a key at all we run the keyword extractor. The other
two lanes cannot tell the difference.

## Pioneer surfaces used

| Surface | What we use it for |
|---|---|
| `GET /base-models` | Live trainable roster (needs no auth) |
| `POST /generate` (`task_type: ner`) | Synthetic 999-call training + eval datasets |
| `POST /generate/ner/label-existing` | Annotating our hand-written fragments, synchronously |
| `POST /felix/training-jobs` | LoRA fine-tune of `fastino/gliner2-base-v1` |
| `POST /felix/evaluations` + `GET /felix/baseline-models` | F1/precision/recall vs frontier LLMs on the same held-out set |
| `POST /inference` | Streaming extraction, one call per transcript fragment |
| `POST /inferences/{id}/feedback` | Dispatcher corrections feeding Adaptive Inference |
| `POST /v1/chat/completions` (Gemma 4) | Briefing-script generation |

## The briefing panel: silent walkthrough + text crew card

**There is no narration and no talking head.** A crew riding to a job cannot
hear it over the sirens, so audio is dead weight. Everything the crew needs is
readable.

```
┌─────────────────────────────────┬──────────────────────┐
│                                 │ ADDRESS   23 Larkfi… │  crew card
│    walkthrough clip N           │ CASUALTY  upstairs…  │  briefing.lines
│    entrance → seat of fire      │ FIRE      kitchen    │  label / value / source
│    (silent)                     │ ENTRY     Hallway    │
│                                 │ ROUTE     kerb → …   │
│  ▸ Landing → Back bedroom       │ AVOID     back door… │
└─────────────────────────────────┴──────────────────────┘
     per-leg text from the Worker's `narration`
```

`briefing.ready` now carries a **`lines`** array of
`{label, value, source}` — scannable rows, not prose, because a crew in a
moving appliance needs to find one fact in one glance. `source` marks
provenance and the console should show it: `call` (said this minute),
`street` (Street View), `listing` (an old property listing, possibly years
stale), `plan` (our inference). Not all four are equally trustworthy and the
crew must be able to tell which is which.

**For Mykyta (your lane, not mine):** play the walkthrough clips back to back
on `ended`, `muted`, and overlay the current leg's `narration` as large
high-contrast text. Hold the last frame when the clips run out. The crew card
sits beside it. `video_url` and `captions_url` on `briefing.ready` are now
empty strings by default — render "no video" honestly rather than a dead
player.

A talking head can be switched back on with `SIZEUP_BUBBLE_MODE` if the
decision reverses; the code path is intact.

### Known limit: listings do not photograph circulation

Tested against Oriol's real golden property (22 Kellett Road, SW2 1EB): the
route runs `entrance hall → stairs → landing → bedroom`, and **only the
bedroom is photographed**. Estate agents shoot rooms they are selling, not
hallways and stairs — which is exactly what a route walks through. The two
unmapped photos in that listing are both exterior facade shots, so this is
not a matcher bug, it is what listings are.

Two consequences, both handled:

* The walkthrough **opens on the Street View frame** of the real building, so
  it starts at the kerb like the route does, and a property whose only
  interior match is the target room still has two real frames to animate
  between.
* `build_payload` returns a **`coverage`** block (`route_rooms`,
  `with_imagery`, `missing`, `opens_on_street_view`). The console must show
  it — "1 of 4 rooms photographed" — because a short walkthrough looks like a
  complete tour otherwise, and that is the kind of quiet overclaim this
  product cannot afford.

Worth raising with Oriol: his `scripts/vet_property.py` already scores golden
candidates on Street View coverage, floor plan and reconstruction quality.
Adding **"has interior circulation photography"** as a fourth criterion would
pick properties that produce a multi-leg walk instead of a single hop.

## The briefing video (fal)

```bash
export FAL_KEY=...
export SIZEUP_AVATAR_URL=https://…/dispatch-officer.png   # required

.venv/bin/python -m backend.intelligence.pipeline quote        # cost first
.venv/bin/python -m backend.intelligence.pipeline pregenerate  # cache the fallback
.venv/bin/python -m backend.intelligence.pipeline budget       # where it went
```

Two ways to make the bubble, switched by `SIZEUP_BUBBLE_MODE`:

| | `avatar` (default) | `fabric` |
|---|---|---|
| model | `veed/avatars/text-to-video` | Kokoro TTS → `veed/fabric-1.0` |
| API calls | 1 | 2 |
| needs a portrait | no | yes (`SIZEUP_AVATAR_URL`) |
| 30s briefing | **$0.18** | $2.40 (480p) / $4.50 (720p) |

`avatar` has text-to-speech built in — script in, talking video out — which is
why it collapses the chain to one call and drops the portrait dependency.
`fabric` is *audio-driven lip-sync*: it animates a still you supply, so it
cannot speak on its own and needs Kokoro (`fal-ai/kokoro/american-english`,
~$0.01) to make the audio first. Keep `fabric` only if you want a face you
chose, or want to name VEED's flagship model on stage.

**Watch the money.** The voucher is *shared with Oriol's reconstruction*.
Three defences: the cheap mode by default, every render cached by script hash
so the same briefing is never paid for twice, and a hard
`SIZEUP_FAL_BUDGET_USD` ceiling that raises rather than quietly draining the
voucher. `.fal-spend.json` is the ledger; `pipeline quote` prices both modes
before you commit.

Every failure in this chain — no key, no avatar, budget hit, render timeout —
degrades to the script plus captions and says so on the bus. The avatar is
first in the PRD's cut order and must never be able to take the briefing panel
down with it.

Also used: OpenAI (nothing in this lane any more — the briefing script moved
to Gemma 4 on Pioneer).

## Notes for whoever picks this up

- **`nr_epochs` must be set explicitly.** The encoder default is 100, which
  would run past the deadline. The NER guide's own example uses 5.
- **Labels are lowercase snake** model-side (`fire_origin`), uppercase in the
  locked `Entity` type (`FIRE_ORIGIN`). `pioneer.LABEL_TO_TYPE` maps them.
- **Entity labels carry descriptions, not bare strings.** Pioneer documents
  this as a real accuracy win for ambiguous labels, and ours are maximally
  ambiguous — `FIRE_ORIGIN`, `VICTIM_LOCATION` and `EXIT` are all "somewhere
  in a house".
- **Threshold is 0.35, not the default 0.5**, because partial fragments need
  recall more than precision; the dedupe layer cleans up the difference.
- **Docs contradict themselves** in three places we depend on (evaluation
  result fields, the feedback body, the generation terminal status). The
  client accepts both spellings of each; do not "fix" that by picking one.
- **First call after a fine-tune returns 425 Too Early** while the on-demand
  deployment cold-starts. `pioneer.warm_up()` exists for this. Do it before
  the demo, not during it.

---

# Side-challenge declaration: Fastino / Pioneer

**We replaced a frontier-LLM call with a fine-tuned specialist model.**

The extraction step — turning a live 999 transcript into structured hazard
entities — started as an LLM call and is now a GLiNER2 encoder fine-tuned on
Pioneer. That swap is the entire reason the console can fire entities
mid-sentence.

**Why a small model is the right tool here, not just the cheap one.** A 999
call and the radio chatter that follows it are a continuous stream, and we
re-extract on *every* fragment including partials — several calls per spoken
sentence. Per-utterance frontier-LLM calls are the wrong instrument on both
latency and cost at that rate. An encoder that scores spans in one forward
pass is the right one.

**Pioneer features used, in the order we used them:**

1. **Synthetic data generation** — `POST /generate` with `task_type: ner` over
   a domain description written for panicked, fragmentary, self-correcting
   emergency speech. We have no corpus of real 999 calls and could not
   ethically obtain one; this is exactly the gap synthetic generation fills.
2. **Auto-labelling** — `POST /generate/ner/label-existing` over fragments we
   wrote by hand, covering what synthetic generation tends to miss: relative
   locations ("the room above the garage"), mid-call corrections, and
   fire-service radio idiom.
3. **Evaluation against frontier models** — `POST /felix/evaluations` scores
   our fine-tune, untuned GLiNER2, and every model in
   `GET /felix/baseline-models` on the *same* held-out set, with a per-entity
   breakdown across our five types. The held-out set is the hand-written one,
   deliberately not drawn from the same distribution as the synthetic training
   data, because an eval set generated by the training-set process would
   flatter the model.
4. **Adaptive inference** — every extraction returns an `inference_id`, and a
   dispatcher marking an entity wrong in the console posts a correction to
   `POST /inferences/{id}/feedback`. Real corrections from real operators are
   the highest-signal training data this system could possibly have.

**Creative GLiNER2 use:** one forward pass returns both the five hazard
entities *and* a triage classification — `persons_reported` vs
`property_fire_no_persons`. "Persons reported" is the real UK mobilisation
category that changes what gets sent to the incident, so this is a single
encoder call producing both the hazard picture and a dispatch decision.

**Gemma 4** writes the crew briefing script, through the same Pioneer key, so
the entire language layer of the product — perception and generation — runs on
Pioneer.

Numbers (F1 per entity type, latency, cost) go here from
`pipeline compare` and `pipeline bench`.
