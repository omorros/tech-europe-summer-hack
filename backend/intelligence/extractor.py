"""Streaming entity extraction for 999 calls and radio chatter (Bill, PRD 1a).

Locked entry point: on_transcript(fragment) -> list[Entity], emitting
`entity.extracted` for new-or-changed entities only. One extractor, two
inputs: live call fragments (source "call") and typed radio updates
(source "radio").

Backends, swappable behind the same extract() shape (PRD section 6 says the
swap must be invisible to the other lanes):
  - PioneerExtractor: fine-tuned GLiNER2 via Pioneer — the real thing and the
    Fastino side-challenge story. Wired once the docs research lands.
  - RegexExtractor: keyword/regex safety net. Works with zero keys, doubles
    as the pre-fine-tune baseline for the eval table.
"""

from __future__ import annotations

import inspect
import os
import re
import time

from shared import bus

from . import config  # noqa: F401  (loads backend/.env on import)
from shared.types import Entity

from . import pioneer

# --------------------------------------------------------------------------
# Dedupe: partials mean the same entity forms across fragments
# ("23 lark" -> "23 larkfield road" -> "23 larkfield road SE15 4ND"),
# so dedupe on normalised value; a value that extends an earlier one replaces
# it (fires as changed), a value contained in an earlier one is suppressed.
# --------------------------------------------------------------------------

_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")


def _normalise(value: str) -> str:
    return _WS.sub(" ", _PUNCT.sub(" ", value.lower())).strip()


class _Dedupe:
    def __init__(self) -> None:
        self._fired: dict[str, dict[str, str]] = {}  # type -> {normalised: raw}

    def check(self, etype: str, value: str) -> bool:
        """True if this (type, value) should fire."""
        norm = _normalise(value)
        if not norm:
            return False
        seen = self._fired.setdefault(etype, {})
        if norm in seen:
            return False
        for prev in list(seen):
            if norm in prev:      # shrunken fragment of something already fired
                return False
            if prev in norm:      # entity grew across partials: replace
                del seen[prev]
        seen[norm] = value
        return True


# One dedupe store per call (keyed by call_id), one for the radio feed.
_dedupe_by_key: dict[str, _Dedupe] = {}


def reset(key: str | None = None) -> None:
    if key is None:
        _dedupe_by_key.clear()
    else:
        _dedupe_by_key.pop(key, None)


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

_ROOM = (
    r"(?:(?:back|rear|front|spare|main|master|top|box)\s+)?"
    r"(?:bed\s?room|kitchen|bath\s?room|lounge|living\s?room|sitting\s?room|"
    r"dining\s?room|hall(?:way)?|landing|attic|loft|basement|cellar|garage|"
    r"conservatory|utility(?:\s?room)?|stairs|staircase|toilet)"
)
_PERSON = (
    r"(?:mum|mom|mother|dad|father|grandma|grandmother|granddad|grandfather|"
    r"grandpa|nan|wife|husband|partner|son|daughter|baby|kids?|child(?:ren)?|"
    r"brother|sister|neighbour|someone|he|she|they)"
)
_HAZARD = (
    r"gas\s+(?:bottle|cylinder|canister|leak)|oxygen\s+(?:tank|cylinder)|"
    r"(?:thick\s+|black\s+|heavy\s+)?smoke|gas|propane|butane|petrol|paraffin|"
    r"flashover|backdraft|explosion|chemicals?|paint\s+thinners?|fireworks|"
    r"electrical\s+(?:fault|fire)"
)
_EXITS = (
    r"(?:front|back|rear|side)\s+(?:door|exit|entrance)|fire\s+escape|"
    r"patio\s+doors?|french\s+doors?"
)
_APPLIANCE = r"cooker|oven|stove|hob|boiler|fireplace|toaster|tumble\s+dryer|washing\s+machine|sofa|tv|television"


class RegexExtractor:
    """Keyword/regex safety net + baseline. Millisecond, keys-free."""

    def label(self) -> str:
        return "keyword extractor"

    _street = re.compile(
        r"\b(\d{1,4}[a-z]?)\s+((?:[a-z][a-z']+\s+){1,3}?"
        r"(?:road|rd|street|lane|avenue|ave|grove|close|drive|way|terrace|"
        r"gardens|court|crescent|place|row|hill|mews|walk|square))\b", re.I)
    _postcode = re.compile(r"\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b", re.I)
    _victim_room = re.compile(
        rf"\b{_PERSON}\b[^.!?]{{0,60}}?\b(?:(upstairs|downstairs)\s+)?"
        rf"(?:in|inside)\s+(?:the\s+|her\s+|his\s+|their\s+|my\s+)?({_ROOM})", re.I)
    _victim_floor = re.compile(
        rf"\b{_PERSON}\b[^.!?]{{0,40}}?\b(?:trapped|stuck|still)\s+"
        r"(upstairs|downstairs|inside)", re.I)
    _fire = [
        re.compile(rf"fire\s+(?:started|began|broke\s+out)\s+(?:in|at|by|near)\s+(?:the\s+)?({_ROOM}|{_APPLIANCE})", re.I),
        re.compile(rf"fire\s+in\s+(?:the\s+)?({_ROOM})", re.I),
        re.compile(rf"(?:the\s+)?({_ROOM})\s*(?:is|'s|was)?\s+on\s+fire", re.I),
    ]
    _hazard = re.compile(
        rf"({_HAZARD})(?:\s+(?:is|are)?\s*(?:in|on|by|near|filling)\s+(?:the\s+)?({_ROOM}|{_APPLIANCE}))?", re.I)
    _exit = re.compile(
        rf"({_EXITS})(?:\s+(?:is|are|'s)?\s*(blocked|locked|jammed|impassable|on\s+fire))?", re.I)

    def extract(self, text: str) -> list[tuple[str, str, float]]:
        found: list[tuple[str, str, float]] = []

        street = self._street.search(text)
        postcode = self._postcode.search(text)
        if street:
            value = f"{street.group(1)} {street.group(2)}".strip()
            if postcode:
                value += " " + postcode.group(1).upper()
            found.append(("ADDRESS", value, 0.9 if postcode else 0.75))
        elif postcode:
            found.append(("ADDRESS", postcode.group(1).upper(), 0.6))

        m = self._victim_room.search(text)
        if m:
            value = " ".join(filter(None, [m.group(1), m.group(2)]))
            found.append(("VICTIM_LOCATION", value, 0.8))
        else:
            m = self._victim_floor.search(text)
            if m:
                found.append(("VICTIM_LOCATION", m.group(1), 0.6))

        for pattern in self._fire:
            m = pattern.search(text)
            if m:
                found.append(("FIRE_ORIGIN", m.group(1), 0.85))
                break

        for m in self._hazard.finditer(text):
            value = f"{m.group(1)} in {m.group(2)}" if m.group(2) else m.group(1)
            found.append(("HAZARD_TYPE", value, 0.75))

        for m in self._exit.finditer(text):
            value = " ".join(filter(None, [m.group(1), m.group(2)]))
            found.append(("EXIT", value, 0.75))

        return found


class PioneerExtractor:
    """GLiNER2 on Pioneer — zero-shot on the base model, or our fine-tuned
    checkpoint once training completes (same code, `model_id` swaps to the
    training-job UUID).

    Native /inference has no streaming, so "streaming extraction" is one
    request per fragment; the limit is 5,000/min, far above demo rate.
    Threshold defaults low because partial fragments need recall.
    """

    def __init__(self, model_id: str = pioneer.BASE_MODEL, *,
                 threshold: float = 0.35, triage: bool = False) -> None:
        self.model_id = model_id
        self.threshold = threshold
        self.schema = pioneer.build_schema(triage=triage)
        # Last call's server-side telemetry — the console's latency badge and
        # the id a dispatcher correction gets attached to.
        self.last_inference_id: str | None = None
        self.last_latency_ms: float | None = None
        self.last_triage: str | None = None

    async def extract(self, text: str) -> list[tuple[str, str, float]]:
        response = await pioneer.ainfer(
            text, model_id=self.model_id, schema=self.schema,
            threshold=self.threshold,
        )
        self.last_inference_id = response.get("inference_id")
        self.last_latency_ms = response.get("latency_ms")
        result = response.get("result", response)
        self.last_triage = pioneer.parse_classification(result)

        found = []
        for label, value, confidence in pioneer.parse_entities(result):
            etype = pioneer.LABEL_TO_TYPE.get(label.lower().replace(" ", "_"))
            if etype:
                found.append((etype, value, confidence))
        return found

    def label(self) -> str:
        tuned = self.model_id != pioneer.BASE_MODEL
        return f"GLiNER2 {'fine-tuned' if tuned else 'base (zero-shot)'}"


_backend: object = RegexExtractor()


def use_backend(backend) -> None:
    """Swap the live backend (regex safety net <-> Pioneer GLiNER2)."""
    global _backend
    _backend = backend


def current_backend():
    return _backend


def auto_select() -> str:
    """Pick the best backend the environment allows, and say which one.

    PIONEER_MODEL_ID is the fine-tuned training-job UUID once we have one;
    without it we still get zero-shot GLiNER2, and without a key at all we
    fall back to regex. The interface never changes, so the other two lanes
    never notice which is live.
    """
    if not pioneer.api_key():
        use_backend(RegexExtractor())
        return "regex (no PIONEER_API_KEY)"
    model_id = os.environ.get("PIONEER_MODEL_ID", pioneer.BASE_MODEL)
    backend = PioneerExtractor(model_id)
    use_backend(backend)
    return backend.label()


# --------------------------------------------------------------------------
# Locked entry point
# --------------------------------------------------------------------------

async def on_transcript(fragment: dict) -> list[Entity]:
    """Runs on every fragment including partials. `fragment` is Mykyta's
    transcript.fragment payload {call_id, seq, text, is_final, speaker};
    radio updates arrive as {text, source: "radio"}."""
    text = fragment.get("text", "")
    source = fragment.get("source", "call")
    key = fragment.get("call_id") or source
    dedupe = _dedupe_by_key.setdefault(key, _Dedupe())

    started = time.perf_counter()
    backend = _backend
    try:
        found = backend.extract(text)
        if inspect.isawaitable(found):
            found = await found
    except Exception as exc:
        # Never let the hazard board go dark: drop to the regex net and say so.
        bus.emit("status", {"stage": "extract", "state": "error",
                            "message": f"{type(exc).__name__}: {exc}"[:200]})
        if not isinstance(backend, RegexExtractor):
            use_backend(RegexExtractor())
            bus.emit("status", {"stage": "extract", "state": "running",
                                "message": "fell back to the keyword extractor"})
        # Rebind so the badge below names what actually produced the entities.
        # Claiming the fine-tuned model on a projected console while the regex
        # net is doing the work would be lying to the room.
        backend = _backend
        found = backend.extract(text)

    elapsed_ms = (time.perf_counter() - started) * 1000
    server_ms = getattr(backend, "last_latency_ms", None)
    bus.emit("status", {
        "stage": "extract", "state": "done",
        "message": f"{_label(backend)} · {server_ms or elapsed_ms:.0f}ms",
    })

    fired: list[Entity] = []
    for etype, value, confidence in found:
        if dedupe.check(etype, value):
            entity: Entity = {
                "type": etype, "value": value, "confidence": confidence,
                "source": source, "ts": time.time(),
            }
            fired.append(entity)
            bus.emit("entity.extracted", entity)
    return fired


def _label(backend) -> str:
    return backend.label() if hasattr(backend, "label") else "keyword extractor"
