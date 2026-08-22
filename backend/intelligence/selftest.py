"""Keys-free smoke test of Bill's lane, end to end.

    uv run python -m intelligence.selftest

Replays a scripted 999 call (with realtime-style growing partials) through
on_transcript, plans a route on the golden room graph, replans after a radio
update, and assembles a briefing script. Zero API keys, zero network.
"""

from __future__ import annotations

import asyncio

from shared import bus
from . import make_briefing, on_transcript, plan_route
from .golden import (
    GOLDEN_APPROACH,
    GOLDEN_ARTIFACTS,
    GOLDEN_ROOM_GRAPH,
    IS_REAL,
)
from .walkthrough import build_payload

# (seq, text, is_final) — seq 1 arrives as growing partials, like the
# realtime transcription API will deliver it.
FRAGMENTS = [
    (0, "hello please help there's a fire in my house", False),
    (1, "we're at 22 kell", False),
    (1, "we're at 22 kellett road", False),
    (1, "we're at 22 kellett road london sw2 1eb", True),
    (2, "my mum is upstairs in the back bedroom she can't walk", True),
    (3, "the fire started in the kitchen there's a gas bottle by the cooker", True),
    (4, "smoke is filling the stairs and the back door is blocked", True),
]

RADIO_UPDATE = "flashover in the kitchen, rear exit blocked"


async def main() -> None:
    events: list[dict] = []
    for event_type in ("entity.extracted", "route.planned", "briefing.ready"):
        bus.subscribe(event_type, events.append)

    print(f"== call fragments ==  (property: {'REAL cache' if IS_REAL else 'fictional fallback'}) ==")
    entities = []
    for seq, text, is_final in FRAGMENTS:
        fired = await on_transcript({
            "call_id": "selftest", "seq": seq, "text": text,
            "is_final": is_final, "speaker": "caller",
        })
        entities.extend(fired)
        for e in fired:
            print(f"  {e['type']:16} {e['value']!r}  ({e['confidence']:.2f})")

    types_fired = {e["type"] for e in entities}
    assert "ADDRESS" in types_fired, "ADDRESS missed — definition-of-done failure"
    assert "VICTIM_LOCATION" in types_fired, "VICTIM_LOCATION missed — definition-of-done failure"

    victim = next(e for e in entities if e["type"] == "VICTIM_LOCATION")
    hazards = [e for e in entities if e["type"] in ("FIRE_ORIGIN", "HAZARD_TYPE", "EXIT")]

    print("\n== route ==")
    route = await plan_route(GOLDEN_ROOM_GRAPH, victim, hazards, GOLDEN_APPROACH)
    print("  " + " -> ".join(w["room_id"] or "kerb" for w in route["waypoints"]))
    print(f"  {route['rationale']}")

    print("\n== radio update: {!r} ==".format(RADIO_UPDATE))
    radio_entities = await on_transcript({"text": RADIO_UPDATE, "source": "radio"})
    for e in radio_entities:
        print(f"  {e['type']:16} {e['value']!r}  (radio)")
    hazards.extend(radio_entities)

    route = await plan_route(GOLDEN_ROOM_GRAPH, victim, hazards, GOLDEN_APPROACH)
    print("  replanned: " + " -> ".join(w["room_id"] or "kerb" for w in route["waypoints"]))
    print(f"  {route['rationale']}")

    print("\n== briefing ==")
    briefing = await make_briefing({
        "address": next(e["value"] for e in reversed(entities) if e["type"] == "ADDRESS"),
        "entities": entities + radio_entities,
        "approach": GOLDEN_APPROACH,
        "route": route,
        "room_graph": GOLDEN_ROOM_GRAPH,
    })
    print(f"  ~{briefing['duration_s']}s: {briefing['script']}")

    print("\n== crew card (what the console shows; sirens mean nobody hears audio) ==")
    for row in briefing.get("lines", []):
        print(f"  {row['label']:<12} {row['value']}   [{row['source']}]")

    print("\n== walkthrough payload (entrance -> seat of fire) ==")
    try:
        payload = build_payload(route, GOLDEN_ROOM_GRAPH, GOLDEN_ARTIFACTS,
                                approach=GOLDEN_APPROACH,
                                hazards=[e["value"] for e in hazards])
        print("  legs: " + " → ".join(r["name"] for r in payload["route"]))
        coverage = payload["coverage"]
        print(f"  imagery: {coverage['with_imagery']}/{coverage['route_rooms']} route rooms"
              + (f", missing {', '.join(coverage['missing'])}" if coverage["missing"] else ""))
    except RuntimeError as exc:
        print(f"  no walkthrough: {exc}")

    print(f"\nOK — {len(events)} events on the bus "
          f"({sum(1 for e in events if e['type'] == 'entity.extracted')} entities, "
          f"{sum(1 for e in events if e['type'] == 'route.planned')} routes, "
          f"{sum(1 for e in events if e['type'] == 'briefing.ready')} briefing)")


if __name__ == "__main__":
    asyncio.run(main())
