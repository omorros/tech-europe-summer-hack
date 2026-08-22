"""Golden-property vetting harness.

Runs candidate addresses through the live pipeline and scores them against
the demo criteria: Street View coverage, agent reaches the listing without
being blocked, floor plan present, enough interior photos. (Reconstruction
quality is judged by eye from the cached scene once fal is wired in.)

    cd backend && uv run python -m scripts.vet_property \
        "22 Kellett Road, London SW2 1EB" "another address" ...

Every run caches its artifacts, so vetting doubles as demo-cache warming.
"""

import asyncio
import sys

from building.approach import find_approach
from building.agent import find_property


async def vet(address: str) -> dict:
    print(f"\n{'='*70}\nVETTING: {address}\n{'='*70}")
    approach = await find_approach(address)
    artifacts = await find_property(address)
    return {
        "address": address,
        "streetview": approach["coverage"],
        "agent_found_listing": bool(artifacts["listing_url"]),
        "floorplan": bool(artifacts["floorplan_url"]),
        "photos": len(artifacts["photos"]),
    }


async def main() -> None:
    addresses = sys.argv[1:]
    if not addresses:
        raise SystemExit("usage: python -m scripts.vet_property 'address 1' 'address 2' ...")
    results = [await vet(a) for a in addresses]  # sequential: one browser at a time

    print(f"\n{'='*70}\nVERDICTS\n{'='*70}")
    for r in results:
        ok = r["streetview"] and r["agent_found_listing"] and r["floorplan"] and r["photos"] >= 5
        print(f"{'PASS' if ok else 'FAIL':4} | sv={'y' if r['streetview'] else 'N'} "
              f"listing={'y' if r['agent_found_listing'] else 'N'} "
              f"floorplan={'y' if r['floorplan'] else 'N'} photos={r['photos']:2} | {r['address']}")


if __name__ == "__main__":
    asyncio.run(main())
