"""Smoke test for floor plan -> room graph on cached artifacts.

    cd backend && uv run python -m scripts.smoke_rooms "22 Kellett Road, London SW2 1EB"
"""

import asyncio
import json
import sys

from building.golden import load_cached
from building.rooms import build_room_graph


async def main() -> None:
    address = sys.argv[1] if len(sys.argv) > 1 else "22 Kellett Road, London SW2 1EB"
    artifacts = load_cached(address, "artifacts")
    if not artifacts:
        raise SystemExit(f"no cached artifacts for {address}, run smoke_agent first")
    graph = await build_room_graph(artifacts)
    print(json.dumps(graph, indent=2))
    print(f"\n{len(graph['rooms'])} rooms, entries: {graph['entry_points']}, "
          f"{len(graph['photo_room_map'])}/{len(artifacts['photos'])} photos matched")


if __name__ == "__main__":
    asyncio.run(main())
