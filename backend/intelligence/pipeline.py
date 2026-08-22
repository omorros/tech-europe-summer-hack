"""Day-of Pioneer CLI: probe -> generate -> train -> evaluate -> compare.

    export PIONEER_API_KEY=pio_sk_...
    uv run python -m intelligence.pipeline probe        # catalog + shapes, do this first
    uv run python -m intelligence.pipeline generate     # synthetic train + eval datasets
    uv run python -m intelligence.pipeline label        # our hand-written set, annotated
    uv run python -m intelligence.pipeline train        # LoRA fine-tune on GLiNER2
    uv run python -m intelligence.pipeline evaluate <job_id>
    uv run python -m intelligence.pipeline compare <job_id>   # vs frontier baselines
    uv run python -m intelligence.pipeline bench <job_id>     # our own latency numbers

fal / VEED Fabric 1.0 briefing video (no Pioneer key needed):

    uv run python -m intelligence.pipeline quote        # cost before committing
    uv run python -m intelligence.pipeline budget       # where the voucher went
    uv run python -m intelligence.pipeline pregenerate  # cache the demo fallback

State (job ids, dataset names) is kept in .pioneer-state.json so a step can
be resumed after a crash without losing the morning's work.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

from . import pioneer
from .seed_calls import all_texts

STATE_PATH = Path(__file__).resolve().parents[2] / ".pioneer-state.json"  # repo root

TRAIN_DATASET = "sizeup-999-train"
EVAL_DATASET = "sizeup-999-eval"


def _state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def _save(**kwargs) -> dict:
    state = _state()
    state.update(kwargs)
    STATE_PATH.write_text(json.dumps(state, indent=2))
    return state


def _dump(label: str, value) -> None:
    print(f"\n--- {label} ---")
    print(json.dumps(value, indent=2, default=str)[:4000])


# --------------------------------------------------------------------------

def probe() -> None:
    """Confirm the key works and print the shapes the docs never show:
    the /inference success envelope, the entity payload, and the live
    trainable-model and baseline-LLM rosters."""
    print("base models (encoder, trainable):")
    for model in pioneer.base_models(supports_training=True, task_type="encoder"):
        if isinstance(model, dict):
            print(f"  {model.get('id') or model.get('model_id')}  "
                  f"train={model.get('supports_training')} "
                  f"infer={model.get('supports_inference')}")
        else:
            print(f"  {model}")

    print("\nbaseline LLMs available for evaluation:")
    try:
        for model in pioneer.baseline_models():
            print(f"  {model.get('id')}  {model.get('name')} ({model.get('provider')})"
                  if isinstance(model, dict) else f"  {model}")
    except pioneer.PioneerError as exc:
        print(f"  unavailable: {exc}")

    print(f"\ngemma for the briefing script ({pioneer.GEMMA_MODEL}):")
    try:
        reply = pioneer.chat([{"role": "user", "content": "Reply with the single word: ready"}],
                             max_tokens=10)
        print(f"  {reply.strip()!r}")
    except pioneer.PioneerError as exc:
        print(f"  unavailable: {exc}")

    sample = ("my mum's upstairs in the back bedroom the fire started in the "
              "kitchen there's a gas bottle by the cooker and the back door's blocked")
    started = time.perf_counter()
    response = pioneer.infer(sample, schema=pioneer.build_schema(triage=True),
                             threshold=0.3)
    wall_ms = (time.perf_counter() - started) * 1000

    _dump("POST /inference raw response (verify the result shape here)", response)
    print(f"\nserver latency_ms={response.get('latency_ms')}  wall={wall_ms:.0f}ms")
    print("parsed entities:")
    for label, value, score in pioneer.parse_entities(response.get("result", response)):
        print(f"  {label:18} {value!r}  {score:.2f}")
    print(f"triage: {pioneer.parse_classification(response.get('result', response))}")


def generate() -> None:
    """Kick off both synthetic datasets. Start this before anything else —
    generation duration is undocumented, so it is the one unknown wait."""
    train = pioneer.generate_ner(TRAIN_DATASET, num_examples=300)
    evaluate_set = pioneer.generate_ner(EVAL_DATASET, num_examples=100)
    _save(train_job=train.get("job_id"), eval_job=evaluate_set.get("job_id"))
    print(f"train generation job: {train.get('job_id')}")
    print(f"eval  generation job: {evaluate_set.get('job_id')}")

    for name, job in (("train", train), ("eval", evaluate_set)):
        print(f"\nwaiting on {name}…")
        done = pioneer.wait_for_generation(
            job["job_id"],
            on_poll=lambda j: print(f"  {j.get('status')} count={j.get('count')}"),
        )
        print(f"  {name} ready: {done.get('count')} examples")

    # The NER training-row schema is undocumented — look at what Pioneer
    # actually wrote so our own uploads match it.
    _dump("generated row sample (this is the real NER row schema)",
          pioneer.dataset_preview(TRAIN_DATASET))


def label() -> None:
    """Annotate our hand-written fragments (synchronous) and save them. These
    become the honest held-out set: hand-written, so not drawn from the same
    distribution as the synthetic training data."""
    texts = all_texts()
    print(f"labelling {len(texts)} hand-written fragments…")
    annotations = pioneer.label_existing(texts)
    out = STATE_PATH.parent / "seed-labelled.json"
    out.write_text(json.dumps(annotations, indent=2, default=str))
    print(f"wrote {out}")
    _dump("first annotations (check the span shape)",
          annotations[:3] if isinstance(annotations, list) else annotations)


def train() -> None:
    """LoRA fine-tune on GLiNER2. nr_epochs is explicit on purpose: the
    encoder default is 100, which would run past the deadline."""
    print(f"waiting for {TRAIN_DATASET} to be ready…")
    pioneer.wait_for_dataset(TRAIN_DATASET)

    job = pioneer.start_training("sizeup-999-extractor", TRAIN_DATASET,
                                 nr_epochs=5, learning_rate=5e-5)
    job_id = job["id"]
    _save(training_job=job_id)
    print(f"training job {job_id} — status {job.get('status')}")

    done = pioneer.wait_for_training(
        job_id, on_poll=lambda j: print(f"  {j.get('status')} {j.get('metrics') or ''}"))
    _dump("training complete", done)

    print("\nwarming up the deployment (first call cold-starts with 425)…")
    latency = pioneer.warm_up(job_id)
    print(f"  warm in {latency:.0f}ms" if latency else "  still cold, retry later")
    print(f"\nPIONEER_MODEL_ID={job_id}   <- put this in .env to go live")


def evaluate(job_id: str) -> None:
    print(f"waiting for {EVAL_DATASET} to be ready…")
    pioneer.wait_for_dataset(EVAL_DATASET)
    started = pioneer.start_evaluation(job_id, EVAL_DATASET)
    eval_id = pioneer.start_evaluation_id(started)
    print(f"evaluation {eval_id} running…")
    result = pioneer.wait_for_evaluation(eval_id)
    _dump("evaluation", pioneer.eval_metrics(result))


def compare(job_id: str) -> None:
    """The Fastino table: our fine-tune vs untuned GLiNER2 vs every frontier
    baseline Pioneer offers, all on the same held-out dataset. Pioneer has no
    side-by-side endpoint, so we run each and diff them ourselves."""
    pioneer.wait_for_dataset(EVAL_DATASET)

    contenders = [("GLiNER2 fine-tuned (ours)", job_id),
                  ("GLiNER2 base (zero-shot)", pioneer.BASE_MODEL)]
    try:
        for model in pioneer.baseline_models():
            if isinstance(model, dict) and model.get("id"):
                contenders.append((model.get("name") or model["id"], model["id"]))
    except pioneer.PioneerError as exc:
        print(f"baseline roster unavailable ({exc}) — comparing against base only")

    rows = []
    for name, model_id in contenders:
        print(f"evaluating {name}…")
        try:
            started = pioneer.start_evaluation(model_id, EVAL_DATASET)
            result = pioneer.wait_for_evaluation(pioneer.start_evaluation_id(started))
            rows.append((name, pioneer.eval_metrics(result)))
        except pioneer.PioneerError as exc:
            print(f"  failed: {exc}")

    print(f"\n{'model':34} {'F1':>7} {'precision':>10} {'recall':>8}")
    for name, metrics in rows:
        print(f"{name:34} {_fmt(metrics['f1']):>7} "
              f"{_fmt(metrics['precision']):>10} {_fmt(metrics['recall']):>8}")

    print(f"\n{'per-entity F1':34} " + " ".join(f"{n[:12]:>13}" for n, _ in rows))
    for label_name in pioneer.LABEL_TO_TYPE:
        cells = []
        for _, metrics in rows:
            entry = (metrics.get("per_entity") or {}).get(label_name) or {}
            cells.append(_fmt(entry.get("f1")))
        print(f"{label_name:34} " + " ".join(f"{c:>13}" for c in cells))

    out = STATE_PATH.parent / "eval-comparison.json"
    out.write_text(json.dumps([{"model": n, **m} for n, m in rows], indent=2))
    print(f"\nwrote {out}")


def bench(model_id: str) -> None:
    """Our own latency numbers — Pioneer publishes none, and 'milliseconds on
    CPU' is a claim we have to be able to back on stage."""
    texts = all_texts()[:20]
    server, wall = [], []
    for text in texts:
        started = time.perf_counter()
        response = pioneer.infer(text, model_id=model_id, threshold=0.35, store=False)
        wall.append((time.perf_counter() - started) * 1000)
        if response.get("latency_ms") is not None:
            server.append(float(response["latency_ms"]))

    def report(name: str, values: list[float]) -> None:
        if values:
            ordered = sorted(values)
            p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
            print(f"  {name}: median {statistics.median(values):.0f}ms  "
                  f"p95 {p95:.0f}ms  n={len(values)}")

    print(f"latency over {len(texts)} fragments, model {model_id}:")
    report("server-side (latency_ms)", server)
    report("wall clock (incl. network)", wall)


def _fmt(value) -> str:
    return f"{value:.3f}" if isinstance(value, (int, float)) else "—"


# --------------------------------------------------------------------------
# fal / VEED Fabric 1.0 briefing video
# --------------------------------------------------------------------------

def budget() -> None:
    """Where the shared voucher has gone."""
    from . import fal_media as fm
    print(f"share:     ${fm.BUDGET_USD:.2f}   (SIZEUP_FAL_BUDGET_USD)")
    print(f"spent:     ${fm.spent_usd():.2f}")
    print(f"remaining: ${fm.remaining_usd():.2f}")
    ledger = fm._ledger()
    for entry in ledger["entries"][-10:]:
        print(f"  ${entry['usd']:>6.3f}  {entry['model']:<34} {entry.get('note', '')}")
    print(f"cached renders: {len(ledger['cache'])}")


def quote(script: str | None = None) -> None:
    """What the corner bubble would cost, per mode, before we commit."""
    from . import fal_media as fm
    from .golden import GOLDEN_BRIEFING
    script = script or GOLDEN_BRIEFING["script"]
    seconds = fm.estimate_seconds(script)
    print(f"{len(script.split())} words ≈ {seconds:.0f}s of speech\n")

    avatar = seconds / 60 * fm.AVATAR_USD_PER_MINUTE
    mark = lambda mode: "   <- default" if mode == fm.BUBBLE_MODE else ""
    print(f"  off     $ 0.00   text crew card only — sirens drown narration{mark('off')}")
    print(f"  avatar  ${avatar:5.2f}   veed/avatars/text-to-video, voice included, "
          f"no portrait{mark('avatar')}")
    for resolution, rate in fm.FABRIC_USD_PER_SECOND.items():
        print(f"  fabric  ${seconds * rate:5.2f}   Kokoro TTS + Fabric {resolution}, "
              f"needs SIZEUP_AVATAR_URL{mark('fabric') if resolution == fm.RESOLUTION else ''}")
    print("\n  the briefing is text; the whole voucher goes to the walkthrough")


def pregenerate() -> None:
    """Render and cache the golden briefing — the demo fallback the PRD asks
    for. Cached by script hash, so re-running it costs nothing."""
    import asyncio

    from . import fal_media as fm
    from .golden import GOLDEN_BRIEFING

    if not fm.available():
        print("FAL_KEY unset or fal-client missing — pip install fal-client")
        raise SystemExit(1)
    if not os.environ.get("SIZEUP_AVATAR_URL"):
        print("SIZEUP_AVATAR_URL unset — Fabric 1.0 needs a dispatch-officer "
              "portrait (public PNG/JPG url) to lip-sync.")
        raise SystemExit(1)

    script = GOLDEN_BRIEFING["script"]
    print(f"rendering at {fm.RESOLUTION}: ~${fm.estimate_render_usd(script):.2f} "
          f"of ${fm.remaining_usd():.2f} remaining…")
    result = asyncio.run(fm.make_video(script))
    print(json.dumps(result, indent=2))


COMMANDS = {"probe": probe, "generate": generate, "label": label, "train": train,
            "evaluate": evaluate, "compare": compare, "bench": bench,
            "budget": budget, "quote": quote, "pregenerate": pregenerate}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        raise SystemExit(1)
    needs_pioneer = sys.argv[1] not in ("budget", "quote", "pregenerate")
    if needs_pioneer and not pioneer.api_key():
        print("PIONEER_API_KEY is not set — sign up at pioneer.ai, "
              "Settings > API Keys (the value is shown once).")
        raise SystemExit(1)
    try:
        COMMANDS[sys.argv[1]](*sys.argv[2:])
    except pioneer.OutOfCredits as exc:
        print(f"\nOUT OF CREDITS: {exc}\n"
              "Retrying will not help — top up at https://agent.pioneer.ai/credits")
        raise SystemExit(2)
    except pioneer.PioneerError as exc:
        print(f"\nPioneer error: {exc}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
