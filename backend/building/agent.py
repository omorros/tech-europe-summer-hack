"""H agent: address -> property listing -> gallery + floor plan.

STUB for the walking skeleton: replays cached golden-property artifacts with
fake agent.step events so Mykyta can build the agent cam against real event
shapes. Real Playwright + Holo loop replaces _run_agent in the 11:45-14:30
window; find_property's signature and events never change.
"""

import asyncio

from shared import bus
from shared.types import Artifacts

from .golden import load_cached

STUB_STEPS = [
    ("navigate", "Opening the property site's sold-prices search"),
    ("type", "Entering the postcode into the search box"),
    ("click", "Selecting the matching address from the results"),
    ("scroll", "Scanning the listing for the photo gallery"),
    ("extract", "Saving interior photos and the floor plan"),
]


async def find_property(address: str) -> Artifacts:
    for i, (action, thought) in enumerate(STUB_STEPS, start=1):
        bus.emit("agent.step", {
            "step": i,
            "action": action,
            "thought": thought,
            "screenshot_url": "",
        })
        await asyncio.sleep(0.5)

    artifacts: Artifacts = load_cached(address, "artifacts") or {
        "address": address,
        "listing_url": "",
        "floorplan_url": "",
        "photos": [],
    }
    bus.emit("agent.artifacts", artifacts)
    return artifacts
