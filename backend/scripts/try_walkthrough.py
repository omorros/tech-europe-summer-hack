"""Address in, walkthrough video out. The whole lane in one command.

    cd backend
    uv run python -m scripts.try_walkthrough                        # golden property
    uv run python -m scripts.try_walkthrough "22 Kellett Road, London SW2 1EB"
    uv run python -m scripts.try_walkthrough --dry                  # plan only, spend nothing
    uv run python -m scripts.try_walkthrough --legs                 # clip per hop, not one take

By default this renders what the console renders: ONE unbroken clip from the
front of the building to the room the fire started in. `--legs` switches to
the older per-hop playlist, which covers more rooms with real photographs but
cuts at every doorway.

Uses the cached property for the address if one exists, so it costs nothing
to re-run the planning. Only the render spends money, and it prints the
estimate and asks before it does. A successful render is written to
backend/cache/<slug>/walkthrough.json, which is what the live console replays.

Opens a local page at the end that plays the clips back to back with the
crew card beside them — which is roughly what the console will look like.
"""

from __future__ import annotations

import asyncio
import json
import sys
import webbrowser
from pathlib import Path

from intelligence import director, make_briefing, on_transcript, plan_route
from intelligence.config import BACKEND_DIR
from intelligence.golden import (GOLDEN_APPROACH, GOLDEN_ARTIFACTS,
                                 GOLDEN_ROOM_GRAPH, IS_REAL)
from intelligence.walkthrough import available, build_payload, poll, start

OUT = BACKEND_DIR / "static" / "briefing" / "try.html"

# What a panicked caller says. The extractor has to find the address, the
# casualty and the fire in this — nothing is passed in structured.
SCRIPT = [
    "hello there's a fire please help",
    "we're at {address}",
    "my mum's still inside she's upstairs in the back bedroom she can't walk",
    "it started in the kitchen there's a gas bottle by the cooker",
    "the stairs are full of smoke and the back door's blocked",
]


def slugify(address: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", address.lower()).strip("-")[:80]


def load_property(address: str) -> tuple[dict, dict, dict, str]:
    """Cached approach/artifacts/rooms for this address, else the golden set."""
    folder = BACKEND_DIR / "cache" / slugify(address)
    needed = ("approach", "artifacts", "rooms")
    if all((folder / f"{n}.json").is_file() for n in needed):
        data = [json.loads((folder / f"{n}.json").read_text()) for n in needed]
        return data[0], data[1], data[2], f"cache/{folder.name}"
    return (GOLDEN_APPROACH, GOLDEN_ARTIFACTS, GOLDEN_ROOM_GRAPH,
            "golden property" + ("" if IS_REAL else " (fictional fallback)"))


async def run(address: str, dry: bool, continuous: bool) -> None:
    approach, artifacts, rooms, source = load_property(address)
    address = artifacts.get("address") or address
    print(f"property: {address}   [{source}]\n")

    print("── the call ──────────────────────────────────────────")
    entities: list[dict] = []
    for line in SCRIPT:
        text = line.format(address=address.lower())
        print(f"  caller: {text}")
        for e in await on_transcript({"call_id": "try", "text": text, "is_final": True}):
            print(f"          → {e['type']:16} {e['value']!r}")
            entities.append(e)

    victim = next((e for e in reversed(entities) if e["type"] == "VICTIM_LOCATION"), None)
    hazards = [e for e in entities if e["type"] in ("FIRE_ORIGIN", "HAZARD_TYPE", "EXIT")]
    if victim is None:
        print("\nno casualty location extracted — nothing to route to")
        return

    print("\n── route ─────────────────────────────────────────────")
    route = await plan_route(rooms, victim, hazards, approach)
    print("  " + " → ".join(w["room_id"] or "kerb" for w in route["waypoints"]))
    print(f"  {route['rationale']}")

    print("\n── crew card ─────────────────────────────────────────")
    briefing = await make_briefing({
        "address": address, "entities": entities, "approach": approach,
        "route": route, "room_graph": rooms,
    })
    for row in briefing.get("lines", []):
        print(f"  {row['label']:<12} {row['value'][:70]}   [{row['source']}]")

    print("\n── walkthrough ───────────────────────────────────────")
    fire = next((e["value"] for e in reversed(entities) if e["type"] == "FIRE_ORIGIN"), None)
    fire_room = None
    if fire:
        from intelligence.route import _match_room
        fire_room = _match_room(rooms, fire)

    payload = build_payload(
        route, rooms, artifacts, approach=approach,
        hazards=[e["value"] for e in hazards], fire_room=fire_room,
        continuous=continuous,
        seconds_per_leg=int(sys.argv[sys.argv.index("--secs") + 1]) if "--secs" in sys.argv else None,
        building_description=f"{approach.get('building_type','house')}, "
                             f"{approach.get('storeys','')} storeys".strip(", "),
    )

    print(f"  mode: {'one continuous take' if continuous else 'a clip per hop'}")
    print(f"  director: {director.backend_name()}")
    direct = director.direct_continuous if continuous else director.direct_legs
    prompts = await direct(
        address=address, approach=approach, graph=rooms, artifacts=artifacts,
        hazards=[e["value"] for e in hazards], walk=payload["route"],
        fire_room=fire_room,
    )
    if prompts:
        payload["leg_prompts"] = prompts
        for i, text in enumerate(prompts):
            print(f"\n  {'shot' if continuous else f'leg {i+1}'}: {text[:600]}")
        print()
    else:
        print("  (no model reachable — the Worker will use its template)")
    coverage = payload["coverage"]
    print("  walk: " + " → ".join(r["name"] for r in payload["route"]))
    print(f"  imagery: {coverage['with_imagery']} of {coverage['photographed_total']} "
          f"photographed rooms; {coverage['route_rooms']} on the route"
          + (f"; missing {', '.join(coverage['missing'])}" if coverage["missing"] else "")
          + (f"; also showing {', '.join(coverage['extra_rooms_shown'])}"
             if coverage.get("extra_rooms_shown") else ""))

    if len(payload["route"]) < 2:
        print("  not enough real imagery to animate — stopping here")
        return
    if dry:
        print("  --dry: planned only, nothing submitted")
        return
    if not available():
        print("  SIZEUP_WORKER_URL not set — is backend/.env filled in?")
        return

    job = await start(payload)
    print(f"  submitted {job['leg_count']} leg(s), {job['seconds_per_leg']}s each, "
          f"~${job['estimated_usd']:.2f}  [{job['job_id']}]")

    print("\n  rendering", end="", flush=True)
    for _ in range(60):
        await asyncio.sleep(10)
        state = await poll(job["job_id"])
        print(f"\r  rendering… {state['progress']}   ", end="", flush=True)
        if state["status"] in ("COMPLETED", "PARTIAL"):
            break
    print()

    for leg in state["legs"]:
        mark = "✓" if leg.get("video_url") else "✗"
        print(f"  {mark} {leg['label']}: {leg['status']}"
              + (f" — {leg['error']}" if leg.get("error") else ""))
        if leg.get("video_url"):
            print(f"      {leg['video_url']}")

    # Same file the live console reads, so the next call at this address plays
    # this render instead of paying for it again.
    playable = [leg for leg in state["legs"] if leg.get("video_url")]
    if playable:
        folder = BACKEND_DIR / "cache" / slugify(address)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "walkthrough.json").write_text(
            json.dumps({"fire_room": fire_room, "legs": playable}, indent=2)
        )
        print(f"  cached to {folder / 'walkthrough.json'}")

    write_page(address, briefing, state, coverage)
    print(f"\n  opened {OUT}")
    webbrowser.open(OUT.as_uri())


def write_page(address: str, briefing: dict, state: dict, coverage: dict) -> None:
    """A one-file preview: clips play back to back, crew card beside them."""
    clips = [l for l in state["legs"] if l.get("video_url")]
    rows = "".join(
        f'<tr><th>{r["label"]}</th><td>{r["value"]}<span class=s>{r["source"]}</span></td></tr>'
        for r in briefing.get("lines", [])
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f"""<!doctype html><meta charset=utf-8>
<title>SizeUp — {address}</title>
<style>
 body{{margin:0;background:#0b0e13;color:#e7ecf3;font:15px/1.5 ui-sans-serif,system-ui}}
 .wrap{{display:grid;grid-template-columns:1fr 380px;gap:18px;padding:18px;height:100vh;box-sizing:border-box}}
 .stage{{position:relative;background:#000;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}}
 video{{width:100%;height:100%;object-fit:contain}}
 .cap{{position:absolute;left:0;right:0;bottom:0;padding:14px 18px;font-size:22px;font-weight:600;
      background:linear-gradient(transparent,rgba(0,0,0,.85))}}
 aside{{overflow:auto}} h1{{font-size:15px;margin:0 0 12px;color:#9fb0c6;font-weight:600}}
 table{{width:100%;border-collapse:collapse}}
 th{{text-align:left;color:#7f8ea3;font-size:11px;letter-spacing:.08em;padding:9px 10px 9px 0;
     vertical-align:top;white-space:nowrap;font-weight:600}}
 td{{padding:9px 0;border-bottom:1px solid #1b212b}}
 .s{{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:99px;font-size:10px;
    background:#1b2430;color:#7f8ea3;vertical-align:middle}}
 .note{{margin-top:16px;padding:10px 12px;border-radius:8px;background:#1a1408;color:#e9c46a;font-size:13px}}
</style>
<div class=wrap>
 <div class=stage><video id=v autoplay muted playsinline></video><div class=cap id=c></div></div>
 <aside>
  <h1>{address}</h1>
  <table>{rows}</table>
  <div class=note>Walkthrough covers {coverage['with_imagery']} of
   {coverage['route_rooms']} rooms on the route. Only photographed rooms are shown;
   the rest are not depicted.</div>
 </aside>
</div>
<script>
const clips = {json.dumps([{ "url": l["video_url"], "text": l.get("narration") or l["label"] } for l in clips])};
const v = document.getElementById('v'), c = document.getElementById('c');
let i = 0;
function play() {{
  if (!clips.length) {{ c.textContent = 'no clips rendered'; return; }}
  v.src = clips[i].url; c.textContent = clips[i].text; v.play();
}}
// Hold the last frame rather than looping — the final frame is the objective.
v.addEventListener('ended', () => {{ if (i < clips.length - 1) {{ i++; play(); }} }});
play();
</script>
""")


def main() -> None:
    argv = sys.argv[1:]
    # Everything that is not a flag or a flag's value is the address. Without
    # the second clause, `--secs 8` on its own was read as the address.
    words = [
        arg for i, arg in enumerate(argv)
        if not arg.startswith("--") and not (i and argv[i - 1] == "--secs")
    ]
    address = words[0] if words else (GOLDEN_ARTIFACTS.get("address") or "")
    asyncio.run(run(address, "--dry" in argv, continuous="--legs" not in argv))


if __name__ == "__main__":
    main()
