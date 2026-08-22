"""Smoke test for the live H agent run.

Needs HAI_API_KEY in backend/.env. Opens a visible Chromium window so you can
watch Holo drive it (this is also our anti-blocking check per property):

    cd backend && uv run python -m scripts.smoke_agent "22 Kellett Road, London SW2 1EB"
"""

import asyncio
import json
import sys

from building.agent import find_property


async def main() -> None:
    address = sys.argv[1] if len(sys.argv) > 1 else "22 Kellett Road, London SW2 1EB"
    artifacts = await find_property(address)
    print(json.dumps(artifacts, indent=2))
    print(f"\n{len(artifacts['photos'])} photos, floorplan: {artifacts['floorplan_url'] or 'MISSING'}")


if __name__ == "__main__":
    asyncio.run(main())
