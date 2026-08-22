"""Authors the video prompts for each walkthrough leg.

The Worker can build prompts from a template, and does when this is
unavailable. But a template cannot look at the floor plan and notice that the
hallway turns right, or that the bedroom is at the back of the house over the
garden. This module hands a model everything we know — the exterior read, the
room graph, the plan image itself, the photo captions, the hazards, the route
— and asks it to direct each shot.

Backends, tried in order, all optional:
  1. Pioneer (Gemma 4) — same key as the extractor, keeps the language layer
     on one platform for the Fastino declaration.
  2. OpenAI — if the lane's key is present.
  3. fal `any-llm/vision` — works off the fal key we already need for the
     render, and is the only one of the three that can *see* the floor plan.
  4. The Worker's own template, if none of the above are configured.

Nothing here is on the critical path: every failure returns None and the
Worker falls back.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
from typing import Any

from shared.types import Approach, Artifacts, RoomGraph

from .config import resolve_static

FAL_VISION_MODEL = os.environ.get("SIZEUP_DIRECTOR_MODEL", "google/gemini-2.5-flash")

# Kling O1 has no negative_prompt field (checked against its OpenAPI schema),
# so exclusions have to live in the prompt text. Stating what the scene *is*
# beats listing what it is not — "deserted" suppresses people far better than
# "no people", which mentions people and often summons them.
HOUSE_IS_EMPTY = (
    "The house is completely deserted. There are no people, no firefighters, "
    "no crew, no figures and no silhouettes anywhere in the frame at any point. "
    "Nothing moves except the camera itself."
)

SYSTEM = f"""You direct short first-person walkthrough clips that help a fire crew \
orient inside a building before they enter it. You will be given everything known \
about one real property and asked to write the prompt for ONE leg of the walk.

Hard rules, in priority order:
1. {HOUSE_IS_EMPTY}
2. The first and last frames are REAL PHOTOGRAPHS of this property and are fixed. \
Your prompt describes only the movement between them. Never contradict what those \
frames show, and never invent rooms, doors or staircases that the floor plan does \
not support.
3. Body-worn camera point of view, walking pace, steady forward motion. No cuts, \
no cross-fades, no drone or crane moves, no slow motion.
4. No text, captions, watermarks, timestamps or UI overlays.
5. Do not depict fire or flames unless the leg explicitly ends in the room where \
the fire is. Smoke should be thin haze at most. A model painting flames into the \
wrong room would mislead a crew.

Write ONE paragraph, 60-90 words, present tense, concrete and visual. Use the floor \
plan to get the direction of travel right — say which way the camera turns and what \
it passes. Reference the start frame as @Image1 and the end frame as @Image2. \
Output only the prompt text."""


def _fal():
    import fal_client
    return fal_client


def _as_data_uri(url: str) -> str | None:
    path = resolve_static(url)
    if path is None or path.stat().st_size > 6_000_000:
        return None
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def build_context(*, address: str, approach: Approach | None, graph: RoomGraph,
                  artifacts: Artifacts, hazards: list[str],
                  route_rooms: list[str]) -> str:
    """Everything we know, as text the model can reason over."""
    rooms = {r["id"]: r for r in graph.get("rooms", [])}
    names = {rid: r.get("name", rid) for rid, r in rooms.items()}

    lines = [f"PROPERTY: {address}"]

    if approach and approach.get("coverage"):
        door = approach.get("front_door") or {}
        lines += [
            "EXTERIOR (read from Street View):",
            f"  type: {approach.get('building_type')}, {approach.get('storeys')} storeys",
            f"  front door: {door.get('side')} — {door.get('description')}",
            f"  rear access: {approach.get('rear_access_note') if approach.get('rear_access') else 'none'}",
        ]
        if approach.get("obstacles"):
            lines.append(f"  obstacles: {'; '.join(approach['obstacles'])}")

    floors: dict[Any, list[str]] = {}
    for r in graph.get("rooms", []):
        floors.setdefault(r.get("floor", 0), []).append(r.get("name", r["id"]))
    lines.append("LAYOUT:")
    for floor in sorted(floors):
        label = "  ground floor" if floor == 0 else f"  floor {floor}"
        lines.append(f"{label}: {', '.join(n.lower() for n in floors[floor])}")

    adjacency = graph.get("adjacency", [])
    if adjacency:
        lines.append("  connections: " + ", ".join(
            f"{names.get(a,a).lower()}–{names.get(b,b).lower()}" for a, b in adjacency[:16]))

    mapped = graph.get("photo_room_map", {})
    captioned = [f"{p['id']}→{names.get(mapped.get(p['id'],''), 'unmatched').lower()}"
                 + (f" ({p['caption']})" if p.get("caption") else "")
                 for p in artifacts.get("photos", [])]
    if captioned:
        lines.append("PHOTOGRAPHS AVAILABLE: " + ", ".join(captioned))

    lines.append("PLANNED ROUTE: " + " → ".join(
        names.get(r, r).lower() for r in route_rooms))
    if hazards:
        lines.append("HAZARDS REPORTED: " + "; ".join(hazards))
    return "\n".join(lines)


async def _ask_pioneer(context: str, leg: str) -> str | None:
    from . import pioneer
    if not pioneer.api_key():
        return None
    try:
        text = await pioneer.achat(
            [{"role": "system", "content": SYSTEM},
             {"role": "user", "content": f"{context}\n\nTHIS LEG: {leg}"}],
            model=os.environ.get("PIONEER_BRIEFING_MODEL", pioneer.GEMMA_MODEL),
            max_tokens=400,
        )
        return text.strip() or None
    except Exception:
        return None


async def _ask_openai(context: str, leg: str, plan_image: str | None) -> str | None:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key)

        # Send the floor plan itself, not just a description of it. Knowing the
        # hallway runs front-to-back is what stops the model inventing a turn.
        content: list[dict[str, Any]] = [
            {"type": "text", "text": f"{context}\n\nTHIS LEG: {leg}"}
        ]
        if plan_image:
            content.append({"type": "text",
                            "text": "The attached image is this property's floor plan. "
                                    "Use it to get the direction of travel right."})
            content.append({"type": "image_url", "image_url": {"url": plan_image}})

        response = await client.chat.completions.create(
            model=os.environ.get("SIZEUP_OPENAI_MODEL", "gpt-5"),
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": content}],
        )
        return (response.choices[0].message.content or "").strip() or None
    except Exception:
        return None


async def _ask_fal_vision(context: str, leg: str, plan_image: str | None) -> str | None:
    """The only backend that can actually look at the floor plan."""
    if not os.environ.get("FAL_KEY"):
        return None
    try:
        arguments: dict[str, Any] = {
            "prompt": f"{SYSTEM}\n\n{context}\n\nTHIS LEG: {leg}",
            "model": FAL_VISION_MODEL,
        }
        endpoint = "fal-ai/any-llm"
        if plan_image:
            arguments["image_url"] = plan_image
            arguments["prompt"] += ("\n\nThe attached image is this property's floor "
                                    "plan. Use it to get the direction of travel right.")
            endpoint = "fal-ai/any-llm/vision"
        result = await _fal().subscribe_async(endpoint, arguments=arguments)
        return (result.get("output") or "").strip() or None
    except Exception:
        return None


async def direct_legs(*, address: str, approach: Approach | None, graph: RoomGraph,
                      artifacts: Artifacts, hazards: list[str],
                      walk: list[dict], fire_room: str | None = None) -> list[str] | None:
    """One prompt per leg, or None if no model is reachable.

    `walk` is the ordered list of frames the video moves through, each
    `{room_id, name, floor}` — the same list the Worker turns into legs.
    """
    if len(walk) < 2:
        return None

    context = build_context(
        address=address, approach=approach, graph=graph, artifacts=artifacts,
        hazards=hazards, route_rooms=[w["room_id"] for w in walk],
    )
    plan_image = _as_data_uri(artifacts.get("floorplan_url", "") or "")

    prompts: list[str] = []
    for i in range(len(walk) - 1):
        a, b = walk[i], walk[i + 1]
        note = ""
        if fire_room and b["room_id"] == fire_room:
            note = " This leg ENDS in the room where the fire is: thickening smoke and firelight ahead."
        elif a.get("floor") is not None and b.get("floor") is not None:
            if b["floor"] > a["floor"]:
                note = " The camera climbs a staircase between these two rooms."
            elif b["floor"] < a["floor"]:
                note = " The camera descends a staircase between these two rooms."

        leg = (f"leg {i + 1} of {len(walk) - 1}: from {a['name']} (@Image1) "
               f"to {b['name']} (@Image2).{note}")

        text = (await _ask_openai(context, leg, plan_image)
                or await _ask_pioneer(context, leg)
                or await _ask_fal_vision(context, leg, plan_image))
        if not text:
            return None
        # Belt and braces: the model may drop rule 1, and it is the rule that
        # put a firefighter in our first render.
        if "deserted" not in text.lower() and "no people" not in text.lower():
            text = f"{text} {HOUSE_IS_EMPTY}"
        prompts.append(text)

    return prompts


def backend_name() -> str:
    from . import pioneer
    if os.environ.get("OPENAI_API_KEY"):
        model = os.environ.get("SIZEUP_OPENAI_MODEL", "gpt-5")
        return f"OpenAI ({model}, sees the floor plan)"
    if pioneer.api_key():
        return f"Pioneer ({pioneer.GEMMA_MODEL})"
    if os.environ.get("FAL_KEY"):
        return f"fal any-llm ({FAL_VISION_MODEL}, sees the floor plan)"
    return "none — Worker template"
