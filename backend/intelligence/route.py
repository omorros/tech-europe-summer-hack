"""Route planning (Bill, PRD 1b): kerb -> entry point -> victim.

Deterministic skeleton today: room matching + BFS constrained to the
adjacency list (PRD section 6: never free-form coordinates). The two
judgement calls — entry-point choice and the rationale line — are rule-based
now with OpenAI upgrades slotted in later; graph traversal stays
deterministic either way.

The entry-point choice is this lane's, not Oriol's: he reports what the
street shows, we weigh it against where the fire is.
"""

from __future__ import annotations

import re
from collections import deque

from shared import bus
from shared.types import Approach, Entity, Route, RoomGraph, Waypoint

from .golden import GOLDEN_ROUTE

# Spoken-phrase aliases -> canonical room vocabulary.
_ALIASES = {
    "living room": "lounge", "sitting room": "lounge", "front room": "lounge",
    "hall": "hallway", "corridor": "hallway",
    "loo": "bathroom", "toilet": "bathroom", "wc": "bathroom",
    "stairs": "landing", "staircase": "landing",
    "cooker": "kitchen", "oven": "kitchen", "stove": "kitchen", "hob": "kitchen",
}

_BLOCKED_WORDS = ("blocked", "locked", "jammed", "impassable", "on fire")


def _tokens(phrase: str) -> set[str]:
    """Room ids arrive kebab-cased ("bedroom-1", "entrance-hall-gf") and names
    shouty with punctuation ("HALLWAY / LANDING", "STAIRS (DN)"), so split on
    everything that is not a word character."""
    phrase = phrase.lower()
    for alias, canonical in _ALIASES.items():
        phrase = phrase.replace(alias, canonical)
    return {token for token in re.split(r"[^a-z0-9]+", phrase) if token}


def _match_room(graph: RoomGraph, phrase: str) -> str | None:
    """Best room id for a spoken phrase like 'upstairs back bedroom'."""
    words = _tokens(phrase)
    best_id, best_score = None, 0
    for room in graph["rooms"]:
        name_words = _tokens(room["name"]) | _tokens(room["id"])
        score = 2 * len(words & name_words)
        if "upstairs" in words and room["floor"] >= 1:
            score += 1
        if "downstairs" in words and room["floor"] == 0:
            score += 1
        if score > best_score:
            best_id, best_score = room["id"], score
    return best_id


def _centroid(polygon: list[list[int]]) -> tuple[int, int]:
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return sum(xs) // len(xs), sum(ys) // len(ys)


def _neighbours(graph: RoomGraph) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = {r["id"]: set() for r in graph["rooms"]}
    for a, b in graph["adjacency"]:
        adj[a].add(b)
        adj[b].add(a)
    return adj


def _bfs(graph: RoomGraph, start: str, goal: str, avoid: set[str]) -> list[str] | None:
    adj = _neighbours(graph)
    queue = deque([[start]])
    seen = {start}
    while queue:
        path = queue.popleft()
        node = path[-1]
        if node == goal:
            return path
        for nxt in adj[node]:
            if nxt in seen or (nxt in avoid and nxt != goal):
                continue
            seen.add(nxt)
            queue.append(path + [nxt])
    return None


def _classify_entry(graph: RoomGraph, entry_id: str) -> str:
    """'front' | 'rear' heuristic from the entry room's name."""
    words = _tokens(entry_id) | _tokens(next(r["name"] for r in graph["rooms"] if r["id"] == entry_id))
    if words & {"kitchen", "utility", "rear", "back", "garage", "conservatory"}:
        return "rear"
    return "front"


def _blocked_sides(exits: list[Entity]) -> set[str]:
    sides = set()
    for e in exits:
        value = e["value"].lower()
        if any(w in value for w in _BLOCKED_WORDS):
            if any(w in value for w in ("back", "rear", "patio", "french")):
                sides.add("rear")
            if any(w in value for w in ("front", "escape")):
                sides.add("front")
    return sides


def plan_size(graph: RoomGraph) -> tuple[int, int]:
    """Floor-plan pixel dimensions. Oriol publishes floorplan_width/height so
    nobody guesses the coordinate space; fall back to the polygon extent only
    if an older graph omits them."""
    width = graph.get("floorplan_width") or graph.get("plan_width")
    height = graph.get("floorplan_height") or graph.get("plan_height")
    if not width:
        width = max(p[0] for r in graph["rooms"] for p in r["polygon"])
    if not height:
        height = max(p[1] for r in graph["rooms"] for p in r["polygon"])
    return int(width), int(height)


def _kerb_waypoint(graph: RoomGraph, entry_room: dict) -> Waypoint:
    """Project the entry room's outside-most door to the nearest plan edge."""
    width, height = plan_size(graph)
    doors = entry_room["doors"] or [list(_centroid(entry_room["polygon"]))]
    best, best_dist = doors[0], 10 ** 9
    for x, y in doors:
        dist = min(x, y, width - x, height - y)
        if dist < best_dist:
            best, best_dist = (x, y), dist
    x, y = best
    # Candidate projections, nearest edge wins. A list, not a dict keyed by
    # distance: equal distances are common (a door dead-centre, or x == y) and
    # a dict would silently drop the tied candidates. Ties resolve in this
    # order — bottom first, because floor plans are drawn with the street at
    # the bottom of the page more often than not.
    candidates = [
        (height - y, (x, height - 2)),   # bottom
        (x, (2, y)),                     # left
        (width - x, (width - 2, y)),     # right
        (y, (x, 2)),                     # top
    ]
    kx, ky = min(candidates, key=lambda c: c[0])[1]
    return {"room_id": None, "x": int(kx), "y": int(ky)}


# TODO(bill): _choose_entry_llm / _rationale_llm — OpenAI upgrades for the two
# judgement calls (PRD 13:00-14:00 slot). Rule-based versions below work today.

def _choose_entry(graph: RoomGraph, fire_rooms: set[str], blocked: set[str],
                  approach: Approach | None) -> tuple[str, str]:
    candidates = list(graph["entry_points"]) or [graph["rooms"][0]["id"]]
    usable = [c for c in candidates
              if c not in fire_rooms and _classify_entry(graph, c) not in blocked]
    if not usable:
        usable = [c for c in candidates if c not in fire_rooms] or candidates

    front = [c for c in usable if _classify_entry(graph, c) == "front"]
    rear = [c for c in usable if _classify_entry(graph, c) == "rear"]

    no_exterior = approach is None or not approach.get("coverage", False)
    fire_at_front = any(_classify_entry(graph, f) == "front" for f in fire_rooms if f in candidates)

    if no_exterior:
        entry = (front or usable)[0]
        return entry, "no exterior view — assuming a front-door approach"
    if fire_at_front and rear and approach.get("rear_access"):
        note = approach.get("rear_access_note") or "rear access available"
        return rear[0], f"fire is at the front — going in from the rear ({note})"
    if front:
        why = "front door clear"
        if fire_rooms:
            why += "; fire is away from the entry"
        return front[0], why
    return usable[0], "front access unusable — entering from the rear"


async def plan_route(graph: RoomGraph, victim: Entity, hazards: list[Entity],
                     approach: Approach) -> Route:
    """Idempotent, cheap, no state left behind — replan on every relevant
    entity change. Emits route.planned."""
    if not graph or not graph.get("rooms"):
        bus.emit("route.planned", GOLDEN_ROUTE)
        return GOLDEN_ROUTE  # never block the console on missing inputs

    rooms_by_id = {r["id"]: r for r in graph["rooms"]}

    fire_rooms = {
        room for e in hazards if e["type"] == "FIRE_ORIGIN"
        for room in [_match_room(graph, e["value"])] if room
    }
    soft_avoid = {
        room for e in hazards if e["type"] == "HAZARD_TYPE"
        for room in [_match_room(graph, e["value"])] if room
    }
    blocked = _blocked_sides([e for e in hazards if e["type"] == "EXIT"])

    victim_room = _match_room(graph, victim["value"]) if victim else None
    if victim_room is None:
        bedrooms = [r["id"] for r in graph["rooms"] if "bed" in r["id"] or "bed" in r["name"].lower()]
        victim_room = (bedrooms or [graph["rooms"][-1]["id"]])[0]

    entry, entry_why = _choose_entry(graph, fire_rooms, blocked, approach)

    notes: list[str] = []
    path = _bfs(graph, entry, victim_room, avoid=fire_rooms | soft_avoid)
    if path is None:
        path = _bfs(graph, entry, victim_room, avoid=fire_rooms)
        if path is not None and soft_avoid:
            names = ", ".join(rooms_by_id[r]["name"].lower() for r in soft_avoid if r in path)
            if names:
                notes.append(f"route passes reported hazards ({names}) — no clear alternative")
    if path is None:
        path = _bfs(graph, entry, victim_room, avoid=set())
        notes.append("no fire-free path — crossing the fire room, crew to confirm")
    if path is None:
        path = [entry, victim_room]

    waypoints: list[Waypoint] = [_kerb_waypoint(graph, rooms_by_id[entry])]
    for room_id in path:
        x, y = _centroid(rooms_by_id[room_id]["polygon"])
        waypoints.append({"room_id": room_id, "x": x, "y": y})

    for side in sorted(blocked):
        notes.append(f"{side} exit reported blocked")

    target = rooms_by_id[victim_room]["name"].lower()
    rationale = f"Enter via the {rooms_by_id[entry]['name'].lower()} ({entry_why}); make for the {target}."
    if notes:
        rationale += " " + "; ".join(notes) + "."

    route: Route = {"waypoints": waypoints, "entry_point": entry, "rationale": rationale}
    bus.emit("route.planned", route)
    return route
