"""Smoke test for fal Hunyuan World reconstruction.

Needs FAL_KEY in backend/.env. Picks the best kitchen photo of the golden
property and generates one scene (~$0.30-0.40):

    cd backend && uv run python -m scripts.smoke_reconstruct "22 Kellett Road, London SW2 1EB"
"""

import asyncio
import json
import sys

from building.golden import load_cached
from building.reconstruct import reconstruct, set_address


async def main() -> None:
    address = sys.argv[1] if len(sys.argv) > 1 else "22 Kellett Road, London SW2 1EB"
    room_id = sys.argv[2] if len(sys.argv) > 2 else "kitchen"
    set_address(address)
    artifacts = load_cached(address, "artifacts")
    rooms = load_cached(address, "rooms")
    if not artifacts or not rooms:
        raise SystemExit("run smoke_agent and smoke_rooms first")
    photo_id = next((pid for pid, rid in rooms["photo_room_map"].items() if rid == room_id), None)
    photo = next((p for p in artifacts["photos"] if p["id"] == photo_id), artifacts["photos"][0])
    print(f"reconstructing {room_id} from {photo['id']}")
    scene = await reconstruct(room_id, photo)
    print(json.dumps(scene, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
