"""fal Hunyuan World reconstruction of critical rooms.

Model: fal-ai/hunyuan_world/image-to-world. One interior photo becomes an
explorable 3D world file; the Scene carries its URL as viewer_url, the source
photo as the thumbnail, and hazard pins located on the thumbnail by gpt-5
(x, y as 0-1 fractions of the image).

Spend discipline: ~$0.30-0.40 a run against our $12.50 share of the voucher,
so cache is checked FIRST and a run counter refuses past RECON_MAX_RUNS.
Degradation: cached scene, else an empty Scene, never a hang.
"""

import base64
import json
import os

from openai import AsyncOpenAI

from shared import bus
from shared.types import Entity, Photo, Scene

from .config import FAL_KEY, OPENAI_VISION_MODEL, STATIC_DIR
from .golden import load_cached, save_cached

MODEL = "fal-ai/hunyuan_world/image-to-world"
MAX_RUNS = int(os.getenv("RECON_MAX_RUNS", "20"))
_runs = 0

_current_address = ""  # set by agent.find_property; keys the scene cache
_hazards: list[Entity] = []  # hazard entities heard on the bus, for pins

# Hunyuan World wants semantic guidance; generic indoor labels work well.
ROOM_LABELS = {
    "kitchen": ("cooker, counter, cabinets", "table, chairs"),
    "bedroom": ("bed, wardrobe", "window, door"),
    "bathroom": ("bath, toilet, sink", "window, door"),
    "reception": ("sofa, table", "window, door"),
    "dining": ("table, chairs", "window, door"),
}
DEFAULT_LABELS = ("furniture", "window, door")


def set_address(address: str) -> None:
    global _current_address
    _current_address = address


def _on_entity(event: dict) -> None:
    payload = event.get("payload", {})
    if payload.get("type") in ("FIRE_ORIGIN", "VICTIM_LOCATION", "HAZARD_TYPE"):
        _hazards.append(payload)


bus.subscribe("entity.extracted", _on_entity)


async def reconstruct(room_id: str, photo: Photo) -> Scene:
    scene = load_cached(_current_address, f"scene_{room_id}")
    if scene is None:
        try:
            scene = await _reconstruct_live(room_id, photo)
            save_cached(_current_address, f"scene_{room_id}", scene)
        except Exception as e:
            print(f"[reconstruct] live failed: {e!r}")
            scene = {"room_id": room_id, "viewer_url": "", "thumbnail_url": photo["url"], "pins": []}
    bus.emit("scene.ready", scene)
    return scene


async def _reconstruct_live(room_id: str, photo: Photo) -> Scene:
    global _runs
    if not FAL_KEY:
        raise RuntimeError("no FAL_KEY configured")
    if _runs >= MAX_RUNS:
        raise RuntimeError(f"reconstruction run cap ({MAX_RUNS}) reached, protecting the voucher")
    _runs += 1

    import fal_client

    local = STATIC_DIR / photo["url"].removeprefix("/static/")
    image_url = await fal_client.upload_file_async(str(local))

    fg1, fg2 = DEFAULT_LABELS
    for key, labels in ROOM_LABELS.items():
        if key in (room_id + " " + (photo.get("caption") or "")).lower():
            fg1, fg2 = labels
            break

    result = await fal_client.subscribe_async(MODEL, arguments={
        "image_url": image_url,
        "labels_fg1": fg1,
        "labels_fg2": fg2,
        "classes": "indoor room",
    })
    viewer_url = result["world_file"]["url"]

    pins = await _locate_pins(local, room_id)
    return {
        "room_id": room_id,
        "viewer_url": viewer_url,
        "thumbnail_url": photo["url"],
        "pins": pins,
    }


async def _locate_pins(photo_path, room_id: str) -> list[dict]:
    """Place hazard entities on the room photo as x, y fractions (0-1)."""
    relevant = [h for h in _hazards if h.get("value")]
    if not relevant:
        return []
    oai = AsyncOpenAI(timeout=45.0)
    b64 = base64.b64encode(photo_path.read_bytes()).decode()
    items = "\n".join(f"- {h['type']}: {h['value']}" for h in relevant[:5])
    schema = {
        "type": "object",
        "properties": {"pins": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "entity_type": {"type": "string"},
                "x": {"type": "number"}, "y": {"type": "number"},
                "present": {"type": "boolean"},
            },
            "required": ["entity_type", "x", "y", "present"],
            "additionalProperties": False,
        }}},
        "required": ["pins"], "additionalProperties": False,
    }
    resp = await oai.chat.completions.create(
        model=OPENAI_VISION_MODEL,
        reasoning_effort="low",
        messages=[{"role": "user", "content": [
            {"type": "text", "text": (
                f"This photo shows the {room_id} of a house involved in a fire "
                f"incident. For each report below, mark where in THIS image the "
                f"hazard or person would most plausibly be, as x and y fractions "
                f"of the image (0-1, origin top-left). Set present=false if the "
                f"report clearly refers to somewhere outside this room.\n{items}")},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        response_format={"type": "json_schema", "json_schema": {
            "name": "pins", "strict": True, "schema": schema}},
    )
    out = json.loads(resp.choices[0].message.content)["pins"]
    return [{"entity_type": p["entity_type"], "x": p["x"], "y": p["y"]}
            for p in out if p["present"]]
