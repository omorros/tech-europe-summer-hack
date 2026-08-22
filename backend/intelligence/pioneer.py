"""Pioneer (Fastino) REST client — the whole GLiNER2 lifecycle we need today.

There is no Python SDK; the docs use plain HTTP with an `X-API-Key` header
(keys start with `pio_sk_`). Everything here is built from docs.pioneer.ai,
with two deliberate defences:

  * The success shape of POST /inference `result` is NOT documented anywhere
    (only 4xx bodies and a feedback-correction example), so `parse_entities`
    accepts every plausible shape and we verify against a live call.
  * Several pages contradict each other (evaluation result fields, feedback
    body, generation terminal status). Where they do, we accept both.

Docs: /quickstart, /concepts/{models,datasets,training,inference,evaluations},
/api-reference/{synthetic-data,training-jobs,evaluations,rate-limits,errors},
/guides/{fine-tune-ner,synthetic-data,adaptive-inference}.
"""

from __future__ import annotations

import os
import time
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    import httpx


def _httpx():
    """Imported lazily so the keys-free walking skeleton runs with no deps
    installed at all — only real Pioneer calls need httpx."""
    import httpx as module
    return module

BASE_URL = os.environ.get("PIONEER_BASE_URL", "https://api.pioneer.ai")

# Verified live against GET /base-models?supports_training=true (that endpoint
# needs no auth) on 2026-08-22: exactly seven trainable models — these four
# GLiNER2 encoders plus three Nemotron decoders. No Gemma is trainable.
BASE_MODEL = "fastino/gliner2-base-v1"          # trains fastest — our default
LARGE_MODEL = "fastino/gliner2-large-v1"        # "higher-accuracy NER", same $0.15/M
PII_MODEL = "fastino/gliner2-privacy-filter-PII-multi"   # inference-only

# Gemma 4 IS live for inference (google/gemma-4-12B-it and -31B-it, both
# deprecated=false in GET /v1/models) even though the changelog announced a
# sunset — so the hackathon's "GLiNER2 and/or Gemma 4" bonus is reachable on
# the generation side. Used for the briefing script; see briefing.py.
GEMMA_MODEL = "google/gemma-4-31B-it"

# Model-side labels are lowercase snake per every docs example; the locked
# Entity types are uppercase. Descriptions are documented to materially
# improve accuracy on ambiguous, domain-specific labels — and ours are
# maximally ambiguous, since FIRE_ORIGIN, VICTIM_LOCATION and EXIT are all
# "somewhere in a house".
LABELS: dict[str, str] = {
    "address": "The street address of the emergency: house or flat number, road name, "
               "postcode, or a named building or landmark the caller gives.",
    "fire_origin": "Where the fire started or is currently burning — a room, a floor, "
                   "or an appliance such as the cooker, the boiler or a tumble dryer.",
    "victim_location": "Where a person still inside the building is: the room, the floor, "
                       "or a described position such as 'upstairs at the back'.",
    "hazard_type": "A hazard that endangers the crew or the casualty: smoke, gas cylinder, "
                   "oxygen, chemicals, petrol, electrical fault, flashover, collapse.",
    "exit": "A way in or out of the building and its state: front or back door, window, "
            "fire escape, staircase — including whether it is blocked, locked or clear.",
}

LABEL_TO_TYPE = {
    "address": "ADDRESS",
    "fire_origin": "FIRE_ORIGIN",
    "victim_location": "VICTIM_LOCATION",
    "hazard_type": "HAZARD_TYPE",
    "exit": "EXIT",
}

# Creative-GLiNER2 head: one forward pass returns entities AND a triage
# classification. "Persons reported" is the real LFB mobilisation category
# that changes what gets sent, so this is a decision the console can act on.
TRIAGE_HEAD = {
    "task": "incident_type",
    "labels": ["persons_reported", "property_fire_no_persons", "unknown"],
}


class PioneerError(RuntimeError):
    pass


class OutOfCredits(PioneerError):
    """402 out_of_credits / 403 credit_ceiling_reached — retrying will not fix it."""


def api_key() -> str | None:
    """Read through config so `backend/.env` is loaded, matching the
    building lane's convention."""
    from .config import PIONEER_API_KEY
    return os.environ.get("PIONEER_API_KEY") or PIONEER_API_KEY or None


def _headers() -> dict[str, str]:
    key = api_key()
    if not key:
        raise PioneerError("PIONEER_API_KEY is not set")
    return {"X-API-Key": key, "Content-Type": "application/json"}


def _check(response: "httpx.Response") -> dict:
    if response.status_code in (402, 403):
        raise OutOfCredits(f"{response.status_code}: {response.text[:300]}")
    if response.status_code >= 400:
        raise PioneerError(f"{response.status_code}: {response.text[:300]}")
    return response.json()


def _retry_after(response: "httpx.Response", default: float) -> float:
    try:
        return float(response.headers.get("Retry-After", default))
    except (TypeError, ValueError):
        return default


# 429 rate limited, 425 on-demand deployment cold-starting after a fine-tune,
# 409 deployment still provisioning — all documented as retry-with-Retry-After.
_RETRY_STATUS = (425, 409, 429, 500, 502, 503, 504)


def request(method: str, path: str, *, json: dict | None = None,
            params: dict | None = None, attempts: int = 5,
            timeout: float = 60.0) -> dict:
    url = f"{BASE_URL}{path}"
    delay = 1.0
    last: "httpx.Response | None" = None
    for attempt in range(attempts):
        response = _httpx().request(method, url, headers=_headers(), json=json,
                                    params=params, timeout=timeout)
        if response.status_code not in _RETRY_STATUS:
            return _check(response)
        last = response
        if response.status_code in (402, 403):
            break
        if attempt < attempts - 1:
            time.sleep(_retry_after(response, delay))
            delay = min(delay * 2, 30.0)
    return _check(last)  # type: ignore[arg-type]


async def arequest(method: str, path: str, *, json: dict | None = None,
                   params: dict | None = None, attempts: int = 3,
                   timeout: float = 30.0) -> dict:
    url = f"{BASE_URL}{path}"
    delay = 0.5
    last: "httpx.Response | None" = None
    async with _httpx().AsyncClient(timeout=timeout) as client:
        for attempt in range(attempts):
            response = await client.request(method, url, headers=_headers(),
                                            json=json, params=params)
            if response.status_code not in _RETRY_STATUS:
                return _check(response)
            last = response
            if response.status_code in (402, 403):
                break
            if attempt < attempts - 1:
                import asyncio
                await asyncio.sleep(_retry_after(response, delay))
                delay = min(delay * 2, 10.0)
    return _check(last)  # type: ignore[arg-type]


# --------------------------------------------------------------------------
# Catalog
# --------------------------------------------------------------------------

def base_models(*, supports_training: bool | None = None,
                task_type: str | None = None) -> list[dict]:
    """GET /base-models — the docs call this the live source of truth for what
    is trainable right now. Call it before hardcoding any model id."""
    params: dict[str, Any] = {}
    if supports_training is not None:
        params["supports_training"] = str(supports_training).lower()
    if task_type:
        params["task_type"] = task_type
    data = request("GET", "/base-models", params=params or None)
    return data.get("models", data) if isinstance(data, dict) else data


def baseline_models() -> list[dict]:
    """GET /felix/baseline-models — the frontier LLMs we can benchmark
    against. The docs never name them, so this call is how we find out."""
    data = request("GET", "/felix/baseline-models")
    return data.get("models", data) if isinstance(data, dict) else data


# --------------------------------------------------------------------------
# Inference
# --------------------------------------------------------------------------

def build_schema(*, labels: dict[str, str] | list[str] | None = None,
                 triage: bool = False) -> dict:
    schema: dict[str, Any] = {"entities": LABELS if labels is None else labels}
    if triage:
        schema["classifications"] = [TRIAGE_HEAD]
    return schema


def parse_entities(result: Any) -> list[tuple[str, str, float]]:
    """(label, text, confidence) from an undocumented `result` payload.

    Handles: {"entities": [{text,label,score}]}, label-keyed dicts
    ({"address": ["..."]} or {"address": [{"text","score"}]}), a bare list of
    spans, and one level of nesting. Unknown labels are dropped by the caller.
    """
    if result is None:
        return []
    if isinstance(result, dict):
        for key in ("entities", "result", "output", "predictions"):
            if key in result:
                return parse_entities(result[key])
        # Label-keyed mapping.
        found: list[tuple[str, str, float]] = []
        for label, values in result.items():
            if not isinstance(label, str) or label not in LABEL_TO_TYPE:
                continue
            for value in values if isinstance(values, list) else [values]:
                if isinstance(value, str):
                    found.append((label, value, 1.0))
                elif isinstance(value, dict):
                    text = value.get("text") or value.get("value") or value.get("span")
                    if text:
                        found.append((label, str(text), _score(value)))
        return found
    if isinstance(result, list):
        found = []
        for item in result:
            if isinstance(item, dict) and ("label" in item or "type" in item):
                label = str(item.get("label") or item.get("type"))
                text = item.get("text") or item.get("value") or item.get("span")
                if text:
                    found.append((label, str(text), _score(item)))
            elif isinstance(item, (list, dict)):
                found.extend(parse_entities(item))
        return found
    return []


def _score(item: dict) -> float:
    for key in ("score", "confidence", "probability", "prob"):
        if key in item:
            try:
                return float(item[key])
            except (TypeError, ValueError):
                pass
    return 1.0


def parse_classification(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    block = result.get("classifications") or result.get("classification")
    if isinstance(block, dict):
        for key in ("label", "prediction", TRIAGE_HEAD["task"]):
            if isinstance(block.get(key), str):
                return block[key]
        block = list(block.values())
    if isinstance(block, list) and block:
        first = block[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            for key in ("label", "prediction", "value"):
                if isinstance(first.get(key), str):
                    return first[key]
    return None


async def ainfer(text: str | list[str], *, model_id: str = BASE_MODEL,
                 schema: dict | None = None, threshold: float = 0.5,
                 store: bool = True) -> dict:
    """POST /inference. No streaming on the native endpoint, so the streaming
    design is one request per transcript fragment (limit is 5,000/min)."""
    payload: dict[str, Any] = {
        "model_id": model_id,
        "text": text,
        "schema": schema or build_schema(),
        "threshold": threshold,
    }
    if not store:
        payload["store"] = False
    return await arequest("POST", "/inference", json=payload)


def infer(text: str | list[str], *, model_id: str = BASE_MODEL,
          schema: dict | None = None, threshold: float = 0.5,
          store: bool = True) -> dict:
    payload: dict[str, Any] = {
        "model_id": model_id,
        "text": text,
        "schema": schema or build_schema(),
        "threshold": threshold,
    }
    if not store:
        payload["store"] = False
    return request("POST", "/inference", json=payload)


async def achat(messages: list[dict], *, model: str = GEMMA_MODEL,
                max_tokens: int = 600, temperature: float = 0.3) -> str:
    """Decoder generation through Pioneer's OpenAI-compatible endpoint.

    Same key, same base URL as the GLiNER2 calls — which is what lets us claim
    the whole language layer runs on Pioneer, and gives us a like-for-like
    latency comparison between the encoder and a general-purpose LLM.
    """
    data = await arequest("POST", "/v1/chat/completions", json={
        "model": model, "messages": messages,
        "max_tokens": max_tokens, "temperature": temperature,
    }, timeout=60.0)
    return data["choices"][0]["message"]["content"]


def chat(messages: list[dict], *, model: str = GEMMA_MODEL,
         max_tokens: int = 600, temperature: float = 0.3) -> str:
    data = request("POST", "/v1/chat/completions", json={
        "model": model, "messages": messages,
        "max_tokens": max_tokens, "temperature": temperature,
    })
    return data["choices"][0]["message"]["content"]


def feedback(inference_id: str, *, verdict: str,
             corrected_output: dict | None = None, notes: str | None = None) -> dict:
    """POST /inferences/{id}/feedback — the corrections that feed Adaptive
    Inference. The OpenAPI spec (verdict required) and the api-reference page
    ({"correction": ...}) disagree; send the spec shape, fall back on 422."""
    body: dict[str, Any] = {"verdict": verdict}
    if corrected_output is not None:
        body["corrected_output"] = corrected_output
    if notes:
        body["notes"] = notes
    try:
        return request("POST", f"/inferences/{inference_id}/feedback", json=body)
    except PioneerError as exc:
        if "422" not in str(exc) or corrected_output is None:
            raise
        return request("POST", f"/inferences/{inference_id}/feedback",
                       json={"correction": corrected_output})


def inferences(**filters: Any) -> dict:
    """GET /inferences — records carry latency_ms and human_* feedback fields
    inline; filters include model_id, latency_min/max, llmaj_score_min/max."""
    return request("GET", "/inferences", params={k: v for k, v in filters.items()
                                                 if v is not None})


# --------------------------------------------------------------------------
# Synthetic data
# --------------------------------------------------------------------------

DOMAIN = (
    "Transcribed UK 999 emergency fire calls and fire-brigade radio chatter. "
    "Callers are panicked and speak in fragments: false starts, repetition, "
    "self-corrections mid-sentence, half-given addresses completed later, "
    "regional and non-native accents rendered phonetically by the transcriber. "
    "They give the street address of the fire, where in the building the fire "
    "started (a room or an appliance like the cooker or a tumble dryer), where "
    "a trapped person is (room and floor, often relative: 'upstairs at the "
    "back', 'the room above the garage'), hazards such as smoke, gas "
    "cylinders, oxygen bottles, chemicals or an imminent flashover, and the "
    "state of exits (front door, back door, windows, fire escape, stairs: "
    "clear, blocked, locked or on fire). Radio chatter from crews on scene is "
    "terser and uses fire-service vocabulary: 'persons reported', 'making up', "
    "'flashover in the kitchen, rear exit blocked'."
)


def generate_ner(dataset_name: str, *, num_examples: int = 200,
                 labels: Iterable[str] | None = None,
                 domain_description: str = DOMAIN) -> dict:
    """POST /generate — async; returns {job_id, status}. 120/min per user."""
    return request("POST", "/generate", json={
        "task_type": "ner",
        "dataset_name": dataset_name,
        "labels": list(labels or LABEL_TO_TYPE.keys()),
        "num_examples": num_examples,
        "domain_description": domain_description,
    })


def generation_job(job_id: str) -> dict:
    return request("GET", f"/generate/jobs/{job_id}")


def label_existing(inputs: list[str], *, labels: Iterable[str] | None = None) -> Any:
    """POST /generate/ner/label-existing — SYNCHRONOUS, 1-1,000 strings per
    call. Our guaranteed-latency path: hand-written fragments in, annotations
    straight back, no job to wait on."""
    return request("POST", "/generate/ner/label-existing", json={
        "labels": list(labels or LABEL_TO_TYPE.keys()),
        "inputs": inputs,
    })


def wait_for_generation(job_id: str, *, timeout_s: float = 900.0,
                        poll_s: float = 5.0, on_poll=None) -> dict:
    """Terminal status is 'ready' per the API reference and 'complete' per the
    guide — accept either."""
    deadline = time.time() + timeout_s
    while True:
        job = generation_job(job_id)
        status = str(job.get("status", "")).lower()
        if on_poll:
            on_poll(job)
        if status in ("ready", "complete", "completed", "succeeded"):
            return job
        if status in ("failed", "error", "errored"):
            raise PioneerError(f"generation failed: {job.get('error')}")
        if time.time() > deadline:
            raise PioneerError(f"generation still {status!r} after {timeout_s}s")
        time.sleep(poll_s)


# --------------------------------------------------------------------------
# Datasets
# --------------------------------------------------------------------------

def datasets() -> dict:
    return request("GET", "/felix/datasets")


def dataset(name: str, version: str = "latest") -> dict:
    return request("GET", f"/felix/datasets/{name}/{version}")


def dataset_preview(name: str, version: str = "latest") -> dict:
    """The NER training-row schema is undocumented — preview a generated
    dataset to learn the real shape before formatting our own rows."""
    return request("GET", f"/felix/datasets/{name}/{version}/preview")


def upload_dataset(name: str, rows: list[dict], *, filename: str = "data.jsonl",
                   dataset_type: str = "ner") -> dict:
    """Documented 3-step flow: presigned URL -> PUT to S3 (no API key on that
    request) -> process. Appending to an existing name creates a new version."""
    import json as _json

    step1 = request("POST", "/felix/datasets/upload/url", json={
        "dataset_name": name, "dataset_type": dataset_type,
        "type": "training", "filename": filename,
    })
    body = "\n".join(_json.dumps(row) for row in rows).encode()
    put = _httpx().put(step1["presigned_url"], content=body, timeout=120.0)
    if put.status_code >= 400:
        raise PioneerError(f"S3 upload failed {put.status_code}: {put.text[:200]}")
    request("POST", "/felix/datasets/upload/process",
            json={"dataset_id": step1["dataset_id"]})
    return step1


def wait_for_dataset(name: str, *, timeout_s: float = 600.0,
                     poll_s: float = 5.0) -> dict:
    """A dataset must be `ready` before a training job will accept it."""
    deadline = time.time() + timeout_s
    while True:
        info = dataset(name)
        status = str(info.get("status", "")).lower()
        if status == "ready":
            return info
        if status in ("failed", "error"):
            raise PioneerError(f"dataset {name} failed: {info.get('processing_error')}")
        if time.time() > deadline:
            raise PioneerError(f"dataset {name} still {status!r} after {timeout_s}s")
        time.sleep(poll_s)


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------

# nr_epochs MUST be explicit: the encoder default is 100, which would blow the
# deadline. The NER guide's own example uses 5.
def start_training(model_name: str, dataset_name: str, *,
                   base_model: str = BASE_MODEL, training_type: str = "lora",
                   nr_epochs: int = 5, learning_rate: float = 5e-5) -> dict:
    return request("POST", "/felix/training-jobs", json={
        "model_name": model_name,
        "base_model": base_model,
        "datasets": [{"name": dataset_name}],
        "training_type": training_type,
        "nr_epochs": nr_epochs,
        "learning_rate": learning_rate,
    })


def training_job(job_id: str) -> dict:
    return request("GET", f"/felix/training-jobs/{job_id}")


def training_logs(job_id: str) -> Any:
    """Point-in-time fetch, not a stream — poll it for a live training panel."""
    return request("GET", f"/felix/training-jobs/{job_id}/logs")


_TRAINING_DONE = ("complete", "completed", "deployed")
_TRAINING_FAILED = ("failed", "errored", "error", "stopped", "cancelled",
                    "terminated")


def wait_for_training(job_id: str, *, timeout_s: float = 3600.0,
                      poll_s: float = 15.0, on_poll=None) -> dict:
    """Lifecycle pages disagree (failed/errored, cancelled/stopped), so treat
    every spelling as terminal."""
    deadline = time.time() + timeout_s
    while True:
        job = training_job(job_id)
        status = str(job.get("status", "")).lower()
        if on_poll:
            on_poll(job)
        if status in _TRAINING_DONE:
            return job
        if status in _TRAINING_FAILED:
            raise PioneerError(f"training {status}: {job.get('error')}")
        if time.time() > deadline:
            raise PioneerError(f"training still {status!r} after {timeout_s}s")
        time.sleep(poll_s)


def checkpoints(job_id: str) -> Any:
    return request("GET", f"/felix/training-jobs/{job_id}/checkpoints")


def deploy_checkpoint(job_id: str, checkpoint_id: str) -> dict:
    """The API-level promotion primitive — also our escape hatch if training
    is still running near the deadline (stop, then deploy the best so far)."""
    return request("POST",
                   f"/felix/training-jobs/{job_id}/checkpoints/{checkpoint_id}/deploy")


def warm_up(model_id: str, *, attempts: int = 10) -> float | None:
    """First call against a freshly provisioned deployment returns 425 Too
    Early. Do this the moment training completes, not on stage."""
    for _ in range(attempts):
        try:
            started = time.perf_counter()
            infer("test call: fire in the kitchen at 1 High Street",
                  model_id=model_id, store=False)
            return (time.perf_counter() - started) * 1000
        except PioneerError as exc:
            if "425" in str(exc) or "409" in str(exc):
                time.sleep(5)
                continue
            raise
    return None


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def start_evaluation(model: str, dataset_name: str) -> dict:
    """`model` is a training-job id (ours), a base model id (untuned
    baseline), or a baseline LLM id from /felix/baseline-models."""
    return request("POST", "/felix/evaluations",
                   json={"base_model": model, "dataset_name": dataset_name})


def evaluation(eval_id: str) -> dict:
    return request("GET", f"/felix/evaluations/{eval_id}")


def wait_for_evaluation(eval_id: str, *, timeout_s: float = 1800.0,
                        poll_s: float = 10.0) -> dict:
    deadline = time.time() + timeout_s
    while True:
        result = evaluation(eval_id)
        status = str(result.get("status", "")).lower()
        if status in ("complete", "completed"):
            return result
        if status in ("failed", "error", "errored"):
            raise PioneerError(f"evaluation failed: {result}")
        if time.time() > deadline:
            raise PioneerError(f"evaluation still {status!r} after {timeout_s}s")
        time.sleep(poll_s)


def eval_metrics(result: dict) -> dict:
    """The concepts page documents nested metrics.{f1,precision,recall,
    per_entity}; the API reference documents flat f1_score/precision_score/
    recall_score. Normalise both into one shape."""
    metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
    def pick(*keys):
        for key in keys:
            for source in (metrics, result):
                if isinstance(source.get(key), (int, float)):
                    return float(source[key])
        return None
    return {
        "f1": pick("f1", "f1_score", "eval_f1_score"),
        "precision": pick("precision", "precision_score", "eval_precision"),
        "recall": pick("recall", "recall_score", "eval_recall"),
        "sample_count": pick("sample_count", "samples", "count"),
        "per_entity": metrics.get("per_entity") or result.get("per_entity") or {},
    }


def start_evaluation_id(response: dict) -> str:
    """POST /felix/evaluations returns {id,status} on one page and
    {success,count,evaluations:[{id}]} on another."""
    if isinstance(response.get("id"), str):
        return response["id"]
    evaluations = response.get("evaluations")
    if isinstance(evaluations, list) and evaluations:
        return evaluations[0]["id"]
    raise PioneerError(f"cannot find evaluation id in {response}")
