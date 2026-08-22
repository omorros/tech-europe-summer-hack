"""A walkthrough for an address we know nothing about but the street.

The full walk needs a floor plan and photographed rooms, which only exist for
a property with a historical listing. Most addresses have none - but every
address in the country has a front. Google gives us that in about two seconds,
and one image is all Kling needs.

So this is the floor under the product: whatever else fails, a crew still gets
a moving approach to the actual building, generated from the actual Street
View frame, for any address they can name.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from shared import bus

MODEL = os.environ.get("LANTERN_STREET_MODEL", "fal-ai/kling-video/o1/image-to-video")
SECONDS = int(os.environ.get("LANTERN_WALK_SECONDS", "10"))
# Kling bills per second of output; a 10s approach is about $1.12.
USD_PER_SECOND = 0.112


def available() -> bool:
    return bool(os.environ.get("FAL_KEY"))


def _prompt(building: str, front_door: str, hazards: list[str]) -> str:
    """What the camera does. Kling follows motion verbs far better than nouns."""
    parts = [
        "Slow steady push forward from the pavement toward the front door of this building,",
        "handheld, eye level, as a firefighter would walk it.",
        f"The building is {building}." if building else "",
        f"The front door is {front_door}." if front_door else "",
        "Daylight, no people, no text, no captions, no vehicles moving.",
        "Keep the building exactly as photographed - do not invent windows, doors or floors.",
    ]
    if hazards:
        parts.append(f"Conditions reported inside: {', '.join(hazards[:3])}.")
    return " ".join(p for p in parts if p)


async def render(
    street_image: str,
    *,
    building: str = "",
    front_door: str = "",
    hazards: list[str] | None = None,
) -> dict[str, Any] | None:
    """One clip walking in from the kerb. Returns a leg, or None."""
    if not available() or not street_image:
        return None

    import fal_client

    prompt = _prompt(building, front_door, hazards or [])
    bus.emit("status", {"stage": "briefing", "state": "running",
                        "message": f"Rendering the approach ({SECONDS}s)"})
    try:
        result: Any = await asyncio.wait_for(
            # Kling o1 names the opening frame start_image_url, not
            # image_url. The Worker's own adapter (worker/src/models.ts) is
            # the reference for this shape.
            fal_client.subscribe_async(MODEL, arguments={
                "prompt": prompt,
                "start_image_url": street_image,
                "duration": str(SECONDS),
            }),
            timeout=float(os.environ.get("LANTERN_STREET_TIMEOUT", "300")),
        )
    except asyncio.TimeoutError:
        bus.emit("status", {"stage": "briefing", "state": "error",
                            "message": "Approach render timed out"})
        return None
    except Exception as exc:  # noqa: BLE001 - the console must hear why
        bus.emit("status", {"stage": "briefing", "state": "error",
                            "message": f"Approach render failed: {exc}"[:200]})
        return None

    video = (result or {}).get("video") or {}
    url = video.get("url")
    if not url:
        return None
    return {
        "index": 0,
        "label": "Approach from the street",
        "from_room_id": "_street",
        "to_room_id": "_street",
        "narration": "Approach from the street.",
        "status": "COMPLETED",
        "video_url": url,
        "error": None,
    }
