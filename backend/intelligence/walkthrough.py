"""Client for the Lantern walkthrough Worker.

Turns our own `Route` + `RoomGraph` + `Artifacts` into the payload the Worker
expects, kicks off the render, and polls for clips.

The walkthrough is the evidence-backed half of the briefing. Firefighters
given an explicit *route* outperform those given a floor plan, because under
stress they should not be planning a path from a drawing (Safety Science
2021, replicated 2023); knowing where the casualty is cut search time 34% in
a 2025 Fire study. So the console shows the walk, not just the plan.

Coordinate space and room ids come straight from Oriol's RoomGraph, and the
room order comes from our own planned route — the entry point we chose, in
the order a crew would actually walk it.
"""

from __future__ import annotations

import base64
import mimetypes
from typing import Any

from shared import bus
from shared.types import Approach, Artifacts, Route, RoomGraph

from .config import WORKER_TOKEN, WORKER_URL, resolve_static


def available() -> bool:
    return bool(WORKER_URL)


# Photos larger than this are sent as-is and will fail if the URL is not
# publicly reachable — better a loud failure than a silently truncated image.
# Kling caps input images at 10MB; base64 inflates by ~37%.
_MAX_INLINE_BYTES = 7_000_000


def _as_public_image(url: str) -> str:
    """Make an image reachable by fal.

    The building lane emits `/static/…` paths, and the backend runs on the
    dispatch laptop behind a phone hotspot — there is no inbound route, so fal
    can never fetch those. Inline the bytes as a data URI instead. At ~180KB a
    photo this is cheap, and it means the walkthrough works with no public
    file hosting anywhere in the stack.
    """
    path = resolve_static(url)
    if path is None:
        return url                      # already absolute, or already a data URI
    if path.stat().st_size > _MAX_INLINE_BYTES:
        return url
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if WORKER_TOKEN:
        headers["Authorization"] = f"Bearer {WORKER_TOKEN}"
    return headers


def _httpx():
    import httpx
    return httpx


def _street_frame(approach: Approach | None,
                  artifacts: Artifacts | None = None,
                  graph: RoomGraph | None = None) -> str | None:
    """An image of the building's exterior to open the walk on.

    First choice is Street View — the building lane pulls several headings
    centred on the one computed from the panorama toward the property, so the
    middle frame is the front elevation.

    But `backend/.gitignore` excludes `static/approach/`, so on a fresh clone
    the cached approach.json references Street View files that are not there.
    Second choice is therefore a listing photo that the room matcher left
    unmapped: those are committed, and on a Rightmove listing an unmatched
    photo is almost always the facade (verified on 22 Kellett Road — both
    unmapped photos are street-level shots of the front of the house).
    """
    for view in _centre_first((approach or {}).get("streetview") or []):
        url = view.get("url")
        if url and (resolve_static(url) or "://" in url):
            return url

    mapped = set((graph or {}).get("photo_room_map", {}))
    for photo in (artifacts or {}).get("photos", []):
        if photo.get("id") in mapped or photo.get("room_id"):
            continue
        if photo.get("url") and resolve_static(photo["url"]):
            return photo["url"]
    return None


def _centre_first(views: list[dict]) -> list[dict]:
    """Middle heading first — it is the one aimed at the property."""
    if not views:
        return []
    middle = len(views) // 2
    order = sorted(range(len(views)), key=lambda i: abs(i - middle))
    return [views[i] for i in order]


def build_payload(route: Route, graph: RoomGraph, artifacts: Artifacts, *,
                  approach: Approach | None = None,
                  hazards: list[str] | None = None,
                  building_description: str = "",
                  seconds_per_leg: int | None = None,
                  extend: bool = True,
                  fire_room: str | None = None,
                  leg_prompts: list[str] | None = None,
                  continuous: bool = False) -> dict[str, Any]:
    """Route + room graph + listing photos -> Worker request.

    `continuous` asks for one unbroken clip from the front of the building to
    the room the fire started in, rather than a clip per hop. Only the two
    ends are photographed then, so the rooms in between stay on the path and
    get named in the prompt instead of being dropped for want of an image —
    which is how a hallway finally makes it into the walk.

    In the per-hop mode, rooms with no photograph are dropped rather than
    guessed at: every leg needs a real image at both ends, which is the
    constraint that stops the model inventing a building.

    Estate agents photograph rooms they are selling, not circulation — so
    hallways, landings and stairs, which is exactly what a route walks
    through, are usually missing. Two consequences handled here:

      * The walk opens on the **Street View frame** of the real building, so
        it starts at the kerb like the route does, and so a property whose
        only interior match is the target room still has two real frames.
      * `coverage` reports how many route rooms actually had imagery, so the
        console can say "3 of 5 rooms" instead of implying a complete tour.
    """
    rooms = {room["id"]: room for room in graph.get("rooms", [])}

    # Floor plans label two upstairs rooms "BEDROOM" and leave it at that. A
    # walk that reads "Bedroom → Bedroom" tells a crew nothing, so append the
    # id's distinguishing suffix when a name is not unique.
    name_counts: dict[str, int] = {}
    for room in rooms.values():
        name_counts[room.get("name", "").lower()] = name_counts.get(room.get("name", "").lower(), 0) + 1

    def display(room_id: str) -> str:
        room = rooms.get(room_id, {})
        name = room.get("name", room_id).title()
        if name_counts.get(room.get("name", "").lower(), 0) > 1:
            suffix = room_id.rsplit("-", 1)[-1]
            if suffix and suffix != room_id:
                name = f"{name} {suffix}"
        return name

    photo_map = graph.get("photo_room_map", {}) or {}
    photo_by_room: dict[str, str] = {}
    for photo in artifacts.get("photos", []):
        # `id` is in the locked Photo type but this crosses a lane boundary,
        # so tolerate its absence rather than crashing the whole briefing.
        room_id = photo.get("room_id") or photo_map.get(photo.get("id") or "")
        if room_id and room_id not in photo_by_room and photo.get("url"):
            photo_by_room[room_id] = photo["url"]

    route_rooms = [w["room_id"] for w in route.get("waypoints", []) if w.get("room_id")]

    ordered: list[dict[str, Any]] = []
    photos: dict[str, str] = {}

    street = _street_frame(approach, artifacts, graph)
    if street:
        ordered.append({"room_id": "_street", "name": "Front of the building",
                        "floor": 0})
        photos["_street"] = _as_public_image(street)

    def add(room_id: str, *, needs_photo: bool = True) -> None:
        have = room_id in photo_by_room
        if needs_photo and not have:
            return
        if any(o["room_id"] == room_id for o in ordered):
            return
        room = rooms.get(room_id, {})
        ordered.append({
            "room_id": room_id,
            "name": display(room_id),
            "floor": room.get("floor", 0),
        })
        if have:
            photos[room_id] = _as_public_image(photo_by_room[room_id])

    if continuous:
        # Entrance to the seat of the fire, in order, and nothing else: the
        # clip is one take, so a detour through the spare bedroom would have
        # to be walked on screen rather than skipped between legs.
        for room_id in route_rooms:
            if room_id != fire_room:
                add(room_id, needs_photo=False)
        if fire_room:
            add(fire_room, needs_photo=False)
        extend = False
    else:
        for room_id in route_rooms:
            add(room_id)

    # The route is the shortest path to the casualty, so it deliberately skips
    # rooms — but a crew still has to know what is behind those doors, and we
    # have paid for the photographs. Extend the walk through the remaining
    # photographed rooms, nearest-first by adjacency so the tour still moves
    # like someone walking rather than teleporting. The fire room goes last,
    # because that is the only leg allowed to show flames.
    if extend:
        adjacency: dict[str, set[str]] = {r["id"]: set() for r in graph.get("rooms", [])}
        for a, b in graph.get("adjacency", []):
            adjacency.setdefault(a, set()).add(b)
            adjacency.setdefault(b, set()).add(a)

        remaining = {r for r in photo_by_room
                     if not any(o["room_id"] == r for o in ordered)}
        remaining.discard(fire_room)

        while remaining:
            current = ordered[-1]["room_id"] if ordered else None
            neighbours = adjacency.get(current, set()) & remaining
            # Prefer a neighbour of where we are; otherwise take any remaining
            # room, which reads as "and also, elsewhere in the building".
            nxt = sorted(neighbours)[0] if neighbours else sorted(remaining)[0]
            remaining.discard(nxt)
            add(nxt)

        if fire_room and fire_room in photo_by_room:
            add(fire_room)

    # Only rooms we actually have an image of count as covered. In continuous
    # mode the path carries unphotographed rooms too, and calling those
    # "covered" would be the exact overclaim this block exists to prevent.
    covered = [r["room_id"] for r in ordered
               if r["room_id"] != "_street" and r["room_id"] in photos]
    off_route = [r for r in covered if r not in route_rooms]
    payload: dict[str, Any] = {
        "address": artifacts.get("address", ""),
        "building_description": building_description,
        "floorplan_description": describe_floorplan(graph),
        "route": ordered,
        "photos": photos,
        "hazards": hazards or [],
        "coverage": {
            "route_rooms": len(route_rooms),
            "with_imagery": len(covered),
            "missing": [rooms.get(r, {}).get("name", r) for r in route_rooms
                        if r not in photo_by_room],
            "opens_on_street_view": bool(street),
            "extra_rooms_shown": off_route,
            "photographed_total": len(photo_by_room),
        },
    }
    if continuous:
        payload["continuous"] = True
    if leg_prompts:
        payload["leg_prompts"] = leg_prompts
    if seconds_per_leg is not None:
        payload["seconds_per_leg"] = seconds_per_leg
    return payload


def describe_floorplan(graph: RoomGraph) -> str:
    """Plain-language layout, floor by floor, plus what connects to what."""
    floors: dict[int, list[str]] = {}
    for room in graph.get("rooms", []):
        floors.setdefault(room.get("floor", 0), []).append(room["name"].lower())

    parts = []
    for floor in sorted(floors):
        label = "Ground floor" if floor == 0 else f"Floor {floor}"
        parts.append(f"{label}: {', '.join(floors[floor])}.")

    names = {room["id"]: room["name"].lower() for room in graph.get("rooms", [])}
    links = [f"{names.get(a, a)}–{names.get(b, b)}"
             for a, b in graph.get("adjacency", [])[:12]]
    if links:
        parts.append("Connections: " + ", ".join(links) + ".")
    return " ".join(parts)


async def start(payload: dict) -> dict:
    """POST /walkthrough — returns immediately with a job id."""
    if not available():
        raise RuntimeError("SIZEUP_WORKER_URL is not set")
    route = payload.get("route", [])
    if len(route) < 2:
        coverage = payload.get("coverage", {})
        raise RuntimeError(
            "not enough real imagery for a walkthrough: "
            f"{coverage.get('with_imagery', 0)} of {coverage.get('route_rooms', 0)} "
            "route rooms are photographed and there is no Street View frame to "
            "open on. The walk needs a real image to start from."
        )
    # The walk has to open on a real image. In continuous mode the route
    # carries rooms with no photograph so the narration can name them, and
    # estate agents rarely photograph the hallway a route enters through — so
    # route[0] having no image is normal, not fatal. Start at the first room
    # that does have one rather than refusing to render at all; `coverage`
    # already tells the console which rooms went unphotographed.
    photos = payload.get("photos", {})
    if not photos.get(route[0]["room_id"]):
        first = next((i for i, hop in enumerate(route) if photos.get(hop["room_id"])), None)
        if first is None or len(route) - first < 2:
            raise RuntimeError(
                "nothing to open the walk on: no photographed room on the route "
                f"({', '.join(hop['room_id'] for hop in route)})"
            )
        skipped = [hop["name"] for hop in route[:first]]
        route = route[first:]
        payload = {**payload, "route": route}
        bus.emit("status", {"stage": "briefing", "state": "running",
                            "message": f"walk opens past {', '.join(skipped)} - not photographed"})
    async with _httpx().AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{WORKER_URL}/walkthrough",
                                     headers=_headers(), json=payload)
        if response.status_code >= 400:
            # raise_for_status alone gives "400 Bad Request" and drops the
            # Worker's explanation, which is the only useful part.
            raise RuntimeError(
                f"walkthrough Worker refused ({response.status_code}): {response.text[:400]}"
            )
        job = response.json()

    bus.emit("status", {"stage": "briefing", "state": "running",
                        "message": f"walkthrough queued: {job.get('leg_count')} legs"})
    return job


async def poll(job_id: str) -> dict:
    """GET /walkthrough/{id} — legs fill in as fal finishes them."""
    async with _httpx().AsyncClient(timeout=60.0) as client:
        response = await client.get(f"{WORKER_URL}/walkthrough/{job_id}",
                                    headers=_headers())
        response.raise_for_status()
        return response.json()


async def wait(job_id: str, *, timeout_s: float = 600.0, poll_s: float = 5.0,
               on_progress=None) -> dict:
    import asyncio
    import time

    deadline = time.time() + timeout_s
    while True:
        job = await poll(job_id)
        if on_progress:
            on_progress(job)
        if job.get("status") in ("COMPLETED", "PARTIAL"):
            return job
        if time.time() > deadline:
            return job                    # hand back whatever landed; never hang the console
        await asyncio.sleep(poll_s)
