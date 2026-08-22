"""Smoke test for the exterior approach pipeline.

Run the moment the Google Maps key lands (PRD: a key without billing fails as
an error image, not an exception, so eyeball the downloaded files too):

    cd backend && uv run python -m scripts.smoke_approach "10 Downing Street, London"
"""

import asyncio
import json
import sys

from building.approach import find_approach


async def main() -> None:
    address = sys.argv[1] if len(sys.argv) > 1 else "10 Downing Street, London SW1A 2AA"
    approach = await find_approach(address)
    print(json.dumps(approach, indent=2))
    print("\nNow open the files in backend/static/approach/ and check they are real")
    print("photos, not grey 'no imagery' or 'billing not enabled' error tiles.")


if __name__ == "__main__":
    asyncio.run(main())
