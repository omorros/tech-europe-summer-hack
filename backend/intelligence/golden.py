"""Golden-property data for the keys-free skeleton.

Prefers the REAL cache Oriol committed (backend/cache/<slug>/) — 22 Kellett
Road, SW2 1EB, with a live approach read, a real Rightmove gallery and a room
graph built from the actual floor plan. Testing against that instead of a
fixture is the whole point: it is what exposed the floorplan_width key, the
kebab-case room ids and the missing circulation photography.

Falls back to the fictional property below when the cache is absent, so this
module never becomes a reason the skeleton cannot run.

Coordinate space: floor-plan pixel coordinates, origin top-left.
"""

from __future__ import annotations

import json
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parents[1] / "cache"


def _load_real() -> tuple[dict, dict, dict] | None:
    """(approach, artifacts, rooms) from the first complete cached property."""
    if not CACHE_DIR.is_dir():
        return None
    for folder in sorted(p for p in CACHE_DIR.iterdir() if p.is_dir()):
        files = {name: folder / f"{name}.json"
                 for name in ("approach", "artifacts", "rooms")}
        if all(path.is_file() for path in files.values()):
            try:
                return tuple(json.loads(path.read_text())  # type: ignore[return-value]
                             for path in files.values())
            except (OSError, json.JSONDecodeError):
                continue
    return None

_FALLBACK_ADDRESS = "23 Larkfield Road, London SE15 4ND"

_FALLBACK_APPROACH = {
    "lat": 51.4702,
    "lng": -0.0631,
    "streetview": [
        {"heading": 200, "url": "/static/golden/sv_200.jpg"},
        {"heading": 230, "url": "/static/golden/sv_230.jpg"},
        {"heading": 260, "url": "/static/golden/sv_260.jpg"},
    ],
    "satellite_url": "/static/golden/satellite.jpg",
    "building_type": "mid-terrace house",
    "storeys": 2,
    "front_door": {"side": "left", "description": "dark door left of the bay window, opens onto the pavement"},
    "access_notes": ["no front garden, door directly on the street", "terrace row — no side passage on either flank"],
    "obstacles": ["cars parked nose-to-tail on both kerbs"],
    "rear_access": True,
    "rear_access_note": "shared alley behind the terrace row reaches the rear garden gate",
    "parking": "kerbside directly outside, single width",
    "coverage": True,
}

_FALLBACK_ROOM_GRAPH = {
    "rooms": [
        {"id": "hallway", "name": "Hallway", "floor": 0,
         "polygon": [[40, 340], [160, 340], [160, 560], [40, 560]],
         "doors": [[100, 560], [160, 450], [100, 340]], "windows": []},
        {"id": "lounge", "name": "Lounge", "floor": 0,
         "polygon": [[160, 340], [360, 340], [360, 560], [160, 560]],
         "doors": [[160, 450]], "windows": [[260, 560]]},
        {"id": "kitchen", "name": "Kitchen", "floor": 0,
         "polygon": [[40, 120], [360, 120], [360, 340], [40, 340]],
         "doors": [[100, 340], [200, 120]], "windows": [[300, 120]]},
        {"id": "landing", "name": "Landing", "floor": 1,
         "polygon": [[440, 340], [560, 340], [560, 560], [440, 560]],
         "doors": [[560, 450], [500, 340]], "windows": []},
        {"id": "bedroom_front", "name": "Front bedroom", "floor": 1,
         "polygon": [[560, 340], [760, 340], [760, 560], [560, 560]],
         "doors": [[560, 450]], "windows": [[660, 560]]},
        {"id": "bedroom_back", "name": "Back bedroom", "floor": 1,
         "polygon": [[440, 120], [660, 120], [660, 340], [440, 340]],
         "doors": [[500, 340]], "windows": [[550, 120]]},
        {"id": "bathroom", "name": "Bathroom", "floor": 1,
         "polygon": [[660, 120], [760, 120], [760, 340], [660, 340]],
         "doors": [[700, 340]], "windows": [[710, 120]]},
    ],
    "adjacency": [
        ["hallway", "lounge"],
        ["hallway", "kitchen"],
        ["hallway", "landing"],   # staircase
        ["landing", "bedroom_front"],
        ["landing", "bedroom_back"],
        ["landing", "bathroom"],
    ],
    "entry_points": ["hallway", "kitchen"],   # front door / rear door
    "photo_room_map": {"p1": "kitchen", "p2": "bedroom_back", "p3": "lounge"},
    # Extra keys per Oriol's PRD 1c: publish plan dimensions so nobody guesses.
    "plan_width": 800,
    "plan_height": 600,
    "floorplan_url": "/static/golden/floorplan.png",
}

# --------------------------------------------------------------------------
# Prefer the real cached property; fall back to the fictional one above.
# --------------------------------------------------------------------------

_real = _load_real()
if _real:
    _approach, _artifacts, _rooms = _real
    GOLDEN_ADDRESS = _artifacts.get("address") or _FALLBACK_ADDRESS
    GOLDEN_APPROACH = _approach
    GOLDEN_ROOM_GRAPH = _rooms
    GOLDEN_ARTIFACTS = _artifacts
    IS_REAL = True
else:
    GOLDEN_ADDRESS = _FALLBACK_ADDRESS
    GOLDEN_APPROACH = _FALLBACK_APPROACH
    GOLDEN_ROOM_GRAPH = _FALLBACK_ROOM_GRAPH
    GOLDEN_ARTIFACTS = {
        "address": GOLDEN_ADDRESS,
        "listing_url": "",
        "floorplan_url": _FALLBACK_ROOM_GRAPH.get("floorplan_url", ""),
        "photos": [
            {"id": pid, "url": f"/static/golden/{pid}.jpg", "caption": "",
             "room_id": rid}
            for pid, rid in _FALLBACK_ROOM_GRAPH["photo_room_map"].items()
        ],
    }
    IS_REAL = False


GOLDEN_ENTITIES = [
    {"type": "ADDRESS", "value": GOLDEN_ADDRESS, "confidence": 0.95, "source": "call", "ts": 0.0},
    {"type": "FIRE_ORIGIN", "value": "kitchen", "confidence": 0.9, "source": "call", "ts": 0.0},
    {"type": "VICTIM_LOCATION", "value": "upstairs back bedroom", "confidence": 0.9, "source": "call", "ts": 0.0},
    {"type": "HAZARD_TYPE", "value": "smoke on the stairs", "confidence": 0.8, "source": "call", "ts": 0.0},
    {"type": "EXIT", "value": "back door blocked", "confidence": 0.8, "source": "call", "ts": 0.0},
]

GOLDEN_ROUTE = {
    "waypoints": [
        {"room_id": None, "x": 100, "y": 598},        # kerb
        {"room_id": "hallway", "x": 100, "y": 450},
        {"room_id": "landing", "x": 500, "y": 450},
        {"room_id": "bedroom_back", "x": 550, "y": 230},
    ],
    "entry_point": "hallway",
    "rationale": "Fire is in the kitchen at the rear — enter by the front door, straight up the stairs, casualty in the back bedroom.",
}

GOLDEN_BRIEFING = {
    "video_url": "/static/golden/briefing.mp4",
    "captions_url": "/static/golden/briefing.vtt",
    "duration_s": 28.0,
    "script": (
        "Incident at 23 Larkfield Road. Mid-terrace house, two storeys. "
        "Front door on the left, opens onto the pavement; rear access via the alley behind the row. "
        "Ground floor: hallway, lounge, kitchen at the rear. Upstairs: two bedrooms and bathroom off the landing. "
        "Fire reported in the kitchen. One casualty in the upstairs back bedroom, unable to walk. "
        "Enter by the front door, up the stairs, back bedroom. Smoke reported on the staircase; back door blocked."
    ),
}
