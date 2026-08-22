"""Crew briefing (Bill, PRD 1c): script -> VEED-on-fal avatar video.

Script order is locked by the PRD: address and building type, approach and
access, layout, fire origin, victim location, entry plan, hazards.

Facts are assembled deterministically, then rewritten by Gemma 4 on Pioneer —
the other half of the Fastino "GLiNER2 and/or Gemma 4" bonus, on the same key
as the extractor. The template output is always the fallback.

The video is VEED Fabric 1.0 on fal (see fal_media.py): script -> speech ->
lip-synced dispatch-officer avatar. Every failure here degrades to the script
plus captions and says so on the bus, because the avatar is first in the PRD's
cut order and must never be able to take the briefing panel down with it.
"""

from __future__ import annotations

import os
import re

from shared import bus

from . import config  # noqa: F401  (loads backend/.env on import)
from shared.types import Briefing

from . import fal_media, pioneer
from .golden import GOLDEN_BRIEFING

_WORDS_PER_SECOND = 2.6
_MAX_SECONDS = 30.0

_POSTCODE = re.compile(r"^[a-z]{1,2}\d[a-z\d]?$|^\d[a-z]{2}$", re.I)


def _spoken_address(raw: str) -> str:
    """Transcripts arrive lowercase; title-case words, uppercase postcodes."""
    return " ".join(
        w.upper() if _POSTCODE.match(w) else w.capitalize() for w in raw.split()
    )


def _script(incident: dict) -> str:
    entities = incident.get("entities") or []
    approach = incident.get("approach")
    route = incident.get("route")
    graph = incident.get("room_graph")

    def first(etype: str) -> str | None:
        # Latest wins: partials grow and callers correct themselves mid-call.
        return next((e["value"] for e in reversed(entities) if e["type"] == etype), None)

    # (priority, line) — higher priority gets dropped first when over 30s.
    # Locked order stays: address/building, approach/access, layout, fire,
    # victim, entry plan, hazards.
    lines: list[tuple[int, str]] = []

    address = _spoken_address(incident.get("address") or first("ADDRESS") or "address not yet confirmed")
    if approach and approach.get("coverage"):
        lines.append((0, f"Incident at {address}. {approach['building_type'].capitalize()}, "
                         f"{approach['storeys']} storeys."))
        door = approach["front_door"]
        lines.append((2, f"Front door on the {door['side']}: {door['description']}."))
        if approach.get("rear_access"):
            lines.append((3, f"Rear access: {approach.get('rear_access_note') or 'available'}."))
        else:
            lines.append((3, "No rear access."))
        lines.append((4, f"Parking: {approach.get('parking')}."))
    else:
        lines.append((0, f"Incident at {address}. No exterior view available."))

    if graph and graph.get("rooms"):
        floors: dict[int, list[str]] = {}
        for room in graph["rooms"]:
            floors.setdefault(room["floor"], []).append(room["name"].lower())
        for floor in sorted(floors):
            label = "Ground floor" if floor == 0 else f"Floor {floor}"
            lines.append((3, f"{label}: {', '.join(floors[floor])}."))

    fire = first("FIRE_ORIGIN")
    if fire:
        lines.append((0, f"Fire reported in the {fire}."))
    victim = first("VICTIM_LOCATION")
    if victim:
        lines.append((0, f"Casualty reported: {victim}."))
    if route:
        lines.append((1, f"Entry plan: {route['rationale']}"))

    hazards = [e["value"] for e in entities if e["type"] in ("HAZARD_TYPE", "EXIT")]
    if hazards:
        lines.append((2, f"Hazards: {'; '.join(hazards)}."))

    # Trim lowest-value lines until the script speaks in under 30 seconds.
    kept = list(lines)
    for drop in (4, 3, 2):
        if sum(len(l.split()) for _, l in kept) / _WORDS_PER_SECOND <= _MAX_SECONDS:
            break
        kept = [(p, l) for p, l in kept if p < drop]

    return " ".join(l for _, l in kept)


_SYSTEM = (
    "You are a UK fire-service dispatch officer briefing a crew en route to a "
    "house fire. Rewrite the facts below as spoken radio briefing, 70 words or "
    "fewer, in this order: address and building type, approach and access, "
    "layout, fire origin, casualty location, entry plan, hazards. Short "
    "declarative sentences. Use fire-service register ('persons reported', "
    "'casualty', 'appliance'). State only the facts given — invent nothing, and "
    "if something is absent say nothing about it. No preamble, no headings, "
    "output only the words to be spoken."
)


async def _polish(facts: str) -> str | None:
    """Rewrite the assembled facts with Gemma 4 on Pioneer.

    Gemma is the other half of the Fastino bonus criterion ("GLiNER2 and/or
    Gemma 4") and it is live for inference on the same key as the extractor.
    Falls back silently to the deterministic script — the video must never
    depend on a generation call succeeding.
    """
    if not pioneer.api_key() or os.environ.get("SIZEUP_BRIEFING_LLM") == "off":
        return None
    try:
        text = await pioneer.achat(
            [{"role": "system", "content": _SYSTEM},
             {"role": "user", "content": facts}],
            model=os.environ.get("PIONEER_BRIEFING_MODEL", pioneer.GEMMA_MODEL),
            max_tokens=250,
        )
        text = text.strip()
        return text or None
    except Exception as exc:
        bus.emit("status", {"stage": "briefing", "state": "error",
                            "message": f"script LLM failed, using template: {exc}"[:200]})
        return None


def _tidy(name: str) -> str:
    """'HALLWAY / LANDING' -> 'Hallway / Landing', 'STAIRS (DN)' -> 'Stairs (Dn)'."""
    return re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), name)


def brief_lines(incident: dict, script: str = "") -> list[dict]:
    """The briefing as scannable label/value rows, not prose.

    A crew reads this in a moving appliance with the sirens on. Prose is the
    wrong shape for that: they need to find one fact in one glance. This is
    the format the wayfinding research points at — explicit route and target,
    so nobody is planning a path from a floor plan under stress.

    `source` marks provenance, which matters because this is life-critical and
    the layers are not equally trustworthy:
      call    — the caller said it, this minute
      street  — read off Street View / satellite
      listing — from an old property listing, may be years out of date
      plan    — our inference from the above
    """
    entities = incident.get("entities") or []
    approach = incident.get("approach")
    route = incident.get("route")
    graph = incident.get("room_graph")

    def latest(etype: str) -> str | None:
        return next((e["value"] for e in reversed(entities) if e["type"] == etype), None)

    rows: list[dict] = []

    def add(label: str, value: str | None, source: str) -> None:
        if value:
            rows.append({"label": label, "value": value, "source": source})

    add("ADDRESS", _spoken_address(incident.get("address") or latest("ADDRESS") or ""), "call")

    if approach and approach.get("coverage"):
        storeys = approach.get("storeys")
        add("BUILDING", f"{approach.get('building_type', '')}"
                        f"{f', {storeys} storeys' if storeys else ''}".strip(", "), "street")
        door = approach.get("front_door") or {}
        add("FRONT DOOR", door.get("side") and f"{door['side']} — {door.get('description','')}".strip(" —"), "street")
        add("REAR ACCESS",
            approach.get("rear_access_note") if approach.get("rear_access") else "none",
            "street")
        add("PARKING", approach.get("parking"), "street")
    else:
        add("BUILDING", "no exterior view available", "plan")

    add("CASUALTY", latest("VICTIM_LOCATION"), "call")
    add("FIRE", latest("FIRE_ORIGIN"), "call")

    if route:
        # Floor-plan labels come through shouty and abbreviated ("HALLWAY /
        # LANDING", "STAIRS (DN)") because that is how they are printed on the
        # plan. Title-case them: this is read at a glance, not shouted.
        rooms = {r["id"]: _tidy(r["name"]) for r in (graph or {}).get("rooms", [])}
        path = [rooms.get(w["room_id"], w["room_id"])
                for w in route.get("waypoints", []) if w.get("room_id")]
        entry = rooms.get(route.get("entry_point"), route.get("entry_point"))
        add("ENTRY", entry, "plan")
        add("ROUTE", " → ".join(["kerb"] + path) if path else None, "plan")

    hazards = [e["value"] for e in entities if e["type"] == "HAZARD_TYPE"]
    blocked = [e["value"] for e in entities if e["type"] == "EXIT"]
    add("HAZARDS", "; ".join(hazards), "call")
    add("AVOID", "; ".join(blocked), "call")

    return rows


async def make_briefing(incident: dict) -> Briefing:
    """incident: {address, entities: [Entity], approach, route, room_graph}.
    Emits briefing.ready."""
    script = await _polish(_script(incident)) or _script(incident)

    # No talking head by default: the crew cannot hear narration over sirens,
    # so the briefing is text the whole way. `script` is the payload that
    # matters, and the console renders it as the readable panel beside the
    # walkthrough. Empty media fields say "there is no video", which the
    # console must render honestly rather than as a dead player.
    briefing: Briefing = {
        "video_url": "",
        "captions_url": "",
        "duration_s": round(len(script.split()) / _WORDS_PER_SECOND, 1),
        "script": script,
    }
    briefing["lines"] = brief_lines(incident, script)   # type: ignore[typeddict-unknown-key]

    talking_head = (fal_media.BUBBLE_MODE != "off"
                    and os.environ.get("SIZEUP_BRIEFING_VIDEO") != "off")

    if talking_head and fal_media.available():
        bus.emit("status", {"stage": "briefing", "state": "running",
                            "message": "rendering avatar briefing on fal…"})
        try:
            media = await fal_media.make_video(script)
            briefing["video_url"] = media["video_url"]
            briefing["captions_url"] = media["captions_url"]
            briefing["duration_s"] = media["duration_s"]
            bus.emit("status", {
                "stage": "briefing", "state": "done",
                "message": ("cached briefing" if media["cached"] else
                            f"VEED Fabric 1.0 · {media['duration_s']:.0f}s · "
                            f"${media['cost_usd']:.2f} (${fal_media.remaining_usd():.2f} left)"),
            })
        except Exception as exc:
            # PRD cut order: avatar render is the first thing to go. Keep the
            # script and the captions, drop the talking head, say so out loud.
            bus.emit("status", {"stage": "briefing", "state": "error",
                                "message": f"avatar render skipped: {exc}"[:200]})

    bus.emit("briefing.ready", briefing)
    return briefing
