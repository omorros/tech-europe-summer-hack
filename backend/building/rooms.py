"""Floor plan -> room graph, photo-room matching.

Division of labour: gpt-5 vision does the understanding (which rooms exist,
where their printed labels are, what connects to what, where the entrances
are) but is never asked for a rectangle, because VLMs point far more reliably
than they box. Geometry is computed deterministically: binarize the plan,
thicken the wall ink until door gaps seal, flood-fill from each label point,
and the fill's bounding box is the room, pixel-accurate by construction.

Coordinate space is the floor plan image's own pixels, origin top-left; the
emission publishes the image dimensions so downstream never guesses.
Degradation: cached golden-property graph on any failure.
"""

import asyncio
import base64
import io
import json
import mimetypes

from openai import AsyncOpenAI
from PIL import Image, ImageDraw, ImageFilter

from shared import bus
from shared.types import Artifacts, RoomGraph

from .config import OPENAI_VISION_MODEL, STATIC_DIR
from .golden import load_cached, save_cached

WALL_THRESHOLD = 128   # gray level below which a pixel counts as wall ink
DILATE_PX = 25         # wall thickening radius; must exceed half a door gap

LABEL_SCHEMA = {
    "type": "object",
    "properties": {
        "rooms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "kebab-case, e.g. kitchen, bedroom-1"},
                    "name": {"type": "string"},
                    "floor": {"type": "integer"},
                    "label_point": {
                        "type": "array", "items": {"type": "number"},
                        "minItems": 2, "maxItems": 2,
                        "description": "pixel [x, y] of the centre of the room's printed label, or of open floor space inside the room if unlabelled",
                    },
                    "bbox": {
                        "type": "array", "items": {"type": "number"},
                        "minItems": 4, "maxItems": 4,
                        "description": "approximate room rectangle [x0, y0, x1, y1] in pixels",
                    },
                    "doors": {
                        "type": "array",
                        "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    },
                    "windows": {
                        "type": "array",
                        "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    },
                },
                "required": ["id", "name", "floor", "label_point", "bbox", "doors", "windows"],
                "additionalProperties": False,
            },
        },
        "adjacency": {
            "type": "array",
            "items": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
        },
        "entry_points": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["rooms", "adjacency", "entry_points"],
    "additionalProperties": False,
}

LABEL_PROMPT = """This is an estate agent floor plan. The image is exactly
{width} x {height} pixels; give every coordinate in that pixel space, origin
at the top-left corner. The plan may draw several floors side by side on the
one image.

A red coordinate grid is drawn on the image every 128 pixels, with each
intersection labelled "x,y". Read coordinates off the grid instead of
estimating; the grid is an overlay, not part of the plan.

List every indoor room (including hallways, landings, bathrooms and WCs).
Cross-hatched or diagonally hatched regions are OUTDOORS (garden, patio,
balcony): they are not rooms. Each separate printed label (e.g. two different
"BEDROOM" labels) is its own room.

For each room give:
- id: short kebab-case identifier
- name: the printed label, or your best guess if unlabelled
- floor: 0 for ground floor, 1 for first floor (UK convention), per the
  plan's floor captions
- label_point: the pixel centre of the room's printed name label; for an
  unlabelled room, a point on open floor space well inside it
- bbox: your best estimate of the room's rectangle [x0, y0, x1, y1]; size
  matters more than exact position
- doors: pixel positions of door openings into the room
- windows: pixel positions of window centres

Also give adjacency (pairs of room ids connected by a door or open passage)
and entry_points (ids of rooms entered directly from outside the dwelling;
look for entrance arrows or "IN" labels)."""

MATCH_PROMPT = """These are interior photos from a property listing, in order:
{photo_list}

The property's rooms are:
{room_list}

Match each photo to the room it most likely shows. Use furniture and features
(cooker = kitchen, bath = bathroom, bed = bedroom). Exterior shots, garden
shots, or photos you cannot place map to null."""

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "photo_id": {"type": "string"},
                    "room_id": {"type": ["string", "null"]},
                },
                "required": ["photo_id", "room_id"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["matches"],
    "additionalProperties": False,
}


def _local_path(url: str):
    return STATIC_DIR / url.removeprefix("/static/")


GRID_STEP = 128


def _gridded_image_part(path) -> dict:
    """The floor plan with a labelled coordinate grid drawn on it: the model
    reads coordinates off the gridlines instead of estimating pixels, which
    is the difference between pointing at a room and pointing near it."""
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    w, h = im.size
    for gx in range(GRID_STEP, w, GRID_STEP):
        d.line([(gx, 0), (gx, h)], fill=(255, 0, 0, 90), width=2)
        for gy in range(GRID_STEP, h, GRID_STEP):
            d.text((gx + 3, gy + 3), f"{gx},{gy}", fill=(255, 0, 0, 160))
    for gy in range(GRID_STEP, h, GRID_STEP):
        d.line([(0, gy), (w, gy)], fill=(255, 0, 0, 90), width=2)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}


def _image_part(url: str) -> dict:
    path = _local_path(url)
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    b64 = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}


# ---------------------------------------------------------------- geometry

def _sealed_walls(im: Image.Image) -> Image.Image:
    """Binarized plan with wall ink dilated enough to close door openings."""
    gray = im.convert("L")
    # MinFilter spreads dark pixels: walls thicken, door gaps seal shut.
    return gray.filter(ImageFilter.MinFilter(2 * DILATE_PX + 1))


def _find_open_pixel(sealed: Image.Image, x: int, y: int) -> tuple[int, int] | None:
    """Nearest non-wall pixel to (x, y): label glyphs are ink, so the exact
    label centre may be black; spiral outward until open floor is found."""
    w, h = sealed.size
    for radius in range(0, 200, 5):
        for dx in range(-radius, radius + 1, 5):
            for dy in (-radius, radius) if radius else (0,):
                for px, py in ((x + dx, y + dy), (x + dy, y + dx)):
                    if 0 <= px < w and 0 <= py < h and sealed.getpixel((px, py)) >= WALL_THRESHOLD:
                        return px, py
    return None


OPEN_PX = 10  # opening radius: prunes thin leak channels from the fill


def _room_bbox(sealed: Image.Image, seed: tuple[int, int]) -> list[float] | None:
    """Flood-fill the sealed plan from seed; the fill's bbox is the room.

    Fills can escape through thin white channels (window gaps, page margins),
    so the filled mask is opened (erode+dilate) to prune snake paths, then
    the connected component still containing the seed is measured.
    """
    work = sealed.copy()
    ImageDraw.floodfill(work, seed, 1, thresh=255 - WALL_THRESHOLD)
    mask = work.point(lambda p: 255 if p == 1 else 0)
    k = 2 * OPEN_PX + 1
    opened = mask.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
    if opened.getpixel(seed) != 255:
        return None  # room too thin or fragmented for CV; caller falls back
    comp = opened.copy()
    ImageDraw.floodfill(comp, seed, 128, thresh=10)
    box = comp.point(lambda p: 255 if p == 128 else 0).getbbox()
    if box is None:
        return None
    grow = DILATE_PX + OPEN_PX  # dilation and opening both shrank the room
    x0 = max(0, box[0] - grow)
    y0 = max(0, box[1] - grow)
    x1 = min(sealed.size[0], box[2] + grow)
    y1 = min(sealed.size[1], box[3] + grow)
    area = (x1 - x0) * (y1 - y0)
    total = sealed.size[0] * sealed.size[1]
    if not 0.002 * total < area < 0.3 * total:
        return None
    return [x0, y0, x1, y1]


def _render_overlay(floorplan_path, plan: dict) -> str:
    """Debug/console visual: rectangles + ids drawn on the plan, as data URL."""
    colors = [
        (255, 0, 0), (0, 140, 255), (0, 180, 0), (255, 140, 0),
        (160, 0, 255), (0, 160, 160), (200, 0, 120), (120, 120, 0),
    ]
    im = Image.open(floorplan_path).convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    for i, r in enumerate(plan["rooms"]):
        c = colors[i % len(colors)]
        poly = [tuple(p) for p in r["polygon"]]
        if len(poly) >= 3:
            d.polygon(poly, outline=c + (255,), fill=c + (40,), width=4)
            cx = sum(p[0] for p in poly) / len(poly)
            cy = sum(p[1] for p in poly) / len(poly)
            d.text((cx - 30, cy - 8), r["id"], fill=c + (255,))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _compute_geometry(floorplan_path, plan: dict, width: int, height: int) -> list[dict]:
    """CPU-bound: seal walls, then flood-fill or recentre each room's box."""
    with Image.open(floorplan_path) as im:
        sealed = _sealed_walls(im)

    rooms = []
    for r in plan["rooms"]:
        x, y = int(r["label_point"][0]), int(r["label_point"][1])
        mx0, my0, mx1, my1 = r["bbox"]
        model_area = max(1.0, (mx1 - mx0) * (my1 - my0))

        seed = _find_open_pixel(sealed, x, y)
        cv = _room_bbox(sealed, seed) if seed else None
        cv_ok = (
            cv is not None
            and cv[0] <= x <= cv[2] and cv[1] <= y <= cv[3]
            and (cv[2] - cv[0]) * (cv[3] - cv[1]) >= 0.5 * model_area
        )
        if cv_ok:
            x0, y0, x1, y1 = cv
        else:
            # The label point is the reliable signal: keep the model's box
            # size but recentre it on the label.
            w2, h2 = (mx1 - mx0) / 2, (my1 - my0) / 2
            x0 = max(0.0, min(x - w2, width - 2 * w2))
            y0 = max(0.0, min(y - h2, height - 2 * h2))
            x1, y1 = x0 + 2 * w2, y0 + 2 * h2
            print(f"[rooms] {r['id']}: flood fill unusable, recentred model box")

        rooms.append({
            "id": r["id"], "name": r["name"], "floor": r["floor"],
            "polygon": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            "doors": r["doors"], "windows": r["windows"],
        })
    return rooms


# ---------------------------------------------------------------- pipeline

async def build_room_graph(artifacts: Artifacts) -> RoomGraph:
    try:
        graph = await _build_live(artifacts)
        save_cached(artifacts["address"], "rooms", graph)
    except Exception as e:
        print(f"[rooms] live pipeline failed: {e!r}, trying cache")
        graph = load_cached(artifacts.get("address", ""), "rooms") or {
            "rooms": [], "adjacency": [], "entry_points": [],
            "photo_room_map": {}, "floorplan_width": 0, "floorplan_height": 0,
        }
    bus.emit("rooms.graph", graph)
    return graph


async def _build_live(artifacts: Artifacts) -> RoomGraph:
    if not artifacts["floorplan_url"]:
        raise ValueError("no floorplan in artifacts")
    oai = AsyncOpenAI(timeout=90.0)  # degrade to cache, never hang the stage

    floorplan_path = _local_path(artifacts["floorplan_url"])
    with Image.open(floorplan_path) as im:
        width, height = im.size

    resp = await oai.chat.completions.create(
        model=OPENAI_VISION_MODEL,
        reasoning_effort="low",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": LABEL_PROMPT.format(width=width, height=height)},
                _gridded_image_part(floorplan_path),
            ],
        }],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "floorplan_labels", "strict": True, "schema": LABEL_SCHEMA},
        },
    )
    plan = json.loads(resp.choices[0].message.content)

    # Rank filters and floodfills are seconds of CPU: off the event loop so
    # the console's WebSocket fan-out never freezes mid-demo.
    rooms = await asyncio.to_thread(_compute_geometry, floorplan_path, plan, width, height)

    # The model can hallucinate ids: everything downstream is filtered
    # against the rooms that actually exist.
    valid_rooms = {r["id"] for r in rooms}
    adjacency = [p for p in plan["adjacency"] if p[0] in valid_rooms and p[1] in valid_rooms]
    entry_points = [e for e in plan["entry_points"] if e in valid_rooms]

    photo_room_map: dict[str, str] = {}
    if artifacts["photos"]:
        photo_list = "\n".join(f"- {p['id']}" for p in artifacts["photos"])
        room_list = "\n".join(f"- {r['id']}: {r['name']} (floor {r['floor']})" for r in rooms)
        content = [{"type": "text", "text": MATCH_PROMPT.format(photo_list=photo_list, room_list=room_list)}]
        for p in artifacts["photos"]:
            content.append({"type": "text", "text": f"Photo {p['id']}:"})
            content.append(_image_part(p["url"]))
        resp = await oai.chat.completions.create(
            model=OPENAI_VISION_MODEL,
            reasoning_effort="low",
            messages=[{"role": "user", "content": content}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "photo_match", "strict": True, "schema": MATCH_SCHEMA},
            },
        )
        matched = json.loads(resp.choices[0].message.content)["matches"]
        photo_room_map = {
            m["photo_id"]: m["room_id"] for m in matched
            if m["room_id"] in valid_rooms
        }

    return {
        "rooms": rooms,
        "adjacency": adjacency,
        "entry_points": entry_points,
        "photo_room_map": photo_room_map,
        "floorplan_width": width,
        "floorplan_height": height,
    }
