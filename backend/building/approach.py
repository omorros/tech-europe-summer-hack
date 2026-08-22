"""Exterior approach: address -> Google Maps imagery -> OpenAI vision -> Approach.

Order of operations (PRD 1a):
  geocode -> Street View metadata (free coverage check + true pano location)
  -> Street View Static at computed headings -> Maps Static satellite
  -> OpenAI vision -> emit approach.ready.

Degradation: cached golden-property approach if anything fails; if Street View
has no coverage we still emit with coverage=False so the console renders an
honest empty state instead of a spinner.
"""

import asyncio
import base64
import json
import math
import time

import httpx
from openai import AsyncOpenAI

from shared import bus
from shared.types import Approach

from .config import GOOGLE_MAPS_API_KEY, OPENAI_VISION_MODEL, STATIC_DIR
from .golden import load_cached, save_cached, slugify

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
SV_META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
SV_IMG_URL = "https://maps.googleapis.com/maps/api/streetview"
STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap"

IMG_SIZE = "640x400"
HEADING_SPREAD = 35  # degrees either side of the direct bearing


def _bearing(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> float:
    """Compass bearing in degrees from the panorama toward the building."""
    p1, p2 = math.radians(from_lat), math.radians(to_lat)
    dl = math.radians(to_lng - from_lng)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "building_type": {"type": "string"},
        "storeys": {"type": "integer"},
        "front_door": {
            "type": "object",
            "properties": {"side": {"type": "string"}, "description": {"type": "string"}},
            "required": ["side", "description"],
            "additionalProperties": False,
        },
        "access_notes": {"type": "array", "items": {"type": "string"}},
        "obstacles": {"type": "array", "items": {"type": "string"}},
        "rear_access": {"type": "boolean"},
        "rear_access_note": {"type": "string"},
        "parking": {"type": "string"},
    },
    "required": [
        "building_type", "storeys", "front_door", "access_notes",
        "obstacles", "rear_access", "rear_access_note", "parking",
    ],
    "additionalProperties": False,
}

VISION_PROMPT = """You are assisting a fire service incident commander with a size-up.
The first images are Street View photos of a building from the road at different
headings; the last image is a satellite view of the plot. The incident address is: {address}

Report only what is visible. Identify: building type (terraced / semi-detached /
detached / flat above shop / block of flats...), number of storeys, which side the
front door is on as seen from the road and what it looks like, access notes (gates,
steps, narrow frontage, obstructions), visible obstacles, whether there appears to
be rear access (alley, side gate, garden backing onto open land), and where a fire
appliance could park. Mention anything resembling a hydrant marker or standpipe in
access_notes. Do NOT recommend an entry point; report observations only."""


async def _fetch_image(client: httpx.AsyncClient, url: str, params: dict, name: str) -> str:
    """Download one Maps image to static/approach/, return its served path."""
    r = await client.get(url, params=params, timeout=15)
    r.raise_for_status()
    out = STATIC_DIR / "approach" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(r.content)
    return f"/static/approach/{name}"


def _b64(path: str) -> str:
    data = (STATIC_DIR / "approach" / path.split("/")[-1]).read_bytes()
    return "data:image/jpeg;base64," + base64.b64encode(data).decode()


async def find_approach(address: str) -> Approach:
    try:
        approach = await _find_approach_live(address)
        if approach["coverage"]:
            save_cached(address, "approach", approach)
        else:
            # A transient no-coverage result must not shadow good cached data
            # or poison the golden cache.
            approach = load_cached(address, "approach") or approach
    except Exception as e:
        print(f"[approach] live pipeline failed: {e!r}, trying cache")
        cached = load_cached(address, "approach")
        if cached is not None:
            approach = cached
        else:
            approach = _empty_approach()
    bus.emit("approach.ready", approach)
    return approach


async def _find_approach_live(address: str) -> Approach:
    slug = slugify(address)
    stamp = int(time.time())
    async with httpx.AsyncClient() as client:
        # 1. Geocode
        r = await client.get(
            GEOCODE_URL,
            params={"address": address, "region": "uk", "key": GOOGLE_MAPS_API_KEY},
            timeout=15,
        )
        geo = r.json()
        if geo.get("status") != "OK":
            raise RuntimeError(f"geocode failed: {geo.get('status')}")
        loc = geo["results"][0]["geometry"]["location"]
        lat, lng = loc["lat"], loc["lng"]

        # 2. Street View metadata: free, confirms coverage, gives true pano position
        r = await client.get(
            SV_META_URL,
            params={"location": f"{lat},{lng}", "key": GOOGLE_MAPS_API_KEY},
            timeout=15,
        )
        meta = r.json()

        # Satellite tile regardless of Street View coverage
        satellite_url = await _fetch_image(
            client,
            STATIC_MAP_URL,
            {
                "center": f"{lat},{lng}",
                "zoom": 19,
                "size": IMG_SIZE,
                "maptype": "satellite",
                "markers": f"color:red|{lat},{lng}",
                "key": GOOGLE_MAPS_API_KEY,
            },
            f"{slug}-{stamp}-satellite.jpg",
        )

        streetview = []
        if meta.get("status") == "OK":
            pano_id = meta["pano_id"]
            pano_loc = meta["location"]
            base = _bearing(pano_loc["lat"], pano_loc["lng"], lat, lng)
            headings = [(base - HEADING_SPREAD) % 360, base, (base + HEADING_SPREAD) % 360]
            fetched = await asyncio.gather(*[
                _fetch_image(
                    client,
                    SV_IMG_URL,
                    {
                        "pano": pano_id,
                        "heading": round(h, 1),
                        "size": IMG_SIZE,
                        "fov": 90,
                        "key": GOOGLE_MAPS_API_KEY,
                    },
                    f"{slug}-{stamp}-sv-{i}.jpg",
                )
                for i, h in enumerate(headings)
            ])
            streetview = [
                {"heading": round(h, 1), "url": u} for h, u in zip(headings, fetched)
            ]

    if not streetview:
        # Honest empty state: coordinates + satellite only
        return {
            **_empty_approach(),
            "lat": lat, "lng": lng, "satellite_url": satellite_url,
        }

    # 3. Vision read of the imagery
    oai = AsyncOpenAI(timeout=60.0)  # degrade to cache, never hang the panel
    images = [{"type": "image_url", "image_url": {"url": _b64(sv["url"])}} for sv in streetview]
    images.append({"type": "image_url", "image_url": {"url": _b64(satellite_url)}})
    resp = await oai.chat.completions.create(
        model=OPENAI_VISION_MODEL,
        messages=[{
            "role": "user",
            "content": [{"type": "text", "text": VISION_PROMPT.format(address=address)}, *images],
        }],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "approach_read", "strict": True, "schema": VISION_SCHEMA},
        },
    )
    read = json.loads(resp.choices[0].message.content)

    return {
        "lat": lat,
        "lng": lng,
        "streetview": streetview,
        "satellite_url": satellite_url,
        "coverage": True,
        **read,
    }


def _empty_approach() -> Approach:
    return {
        "lat": 0.0, "lng": 0.0, "streetview": [], "satellite_url": "",
        "building_type": "unknown", "storeys": 0,
        "front_door": {"side": "unknown", "description": ""},
        "access_notes": [], "obstacles": [],
        "rear_access": False, "rear_access_note": "", "parking": "",
        "coverage": False,
    }
