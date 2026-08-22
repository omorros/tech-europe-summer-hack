"""Scout Rightmove sold-price listings for golden-property candidates.

Deterministic crawl (no Holo, scouting only; the demo still runs the live
agent): for each area page, open sold-price detail pages and count photos and
floor plans from page source, then check Google Street View coverage for the
keepers. Output: a ranked candidate list.

    cd backend && uv run python -m scripts.scout_properties sw2 se24 n16
"""

import asyncio
import re
import sys

import httpx
from playwright.async_api import async_playwright

from building.config import GOOGLE_MAPS_API_KEY

MEDIA_RE = re.compile(r"https://media\.rightmove\.co\.uk/[^\"'\\\s)]+")
HASH_RE = re.compile(r"/([0-9a-f]{16,})[^/]*\.(?:jpe?g|png|gif)$", re.IGNORECASE)
SV_META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"

PER_AREA = 10  # detail pages examined per area


def _unique_media(html: str) -> tuple[int, int]:
    urls = set(MEDIA_RE.findall(html))
    photos = {m.group(1) for u in urls if "property-photo" in u and (m := HASH_RE.search(u))}
    plans = {m.group(1) for u in urls if "floorplan" in u.lower() and (m := HASH_RE.search(u))}
    return len(photos), len(plans)


async def scout_area(page, area: str) -> list[dict]:
    await page.goto(f"https://www.rightmove.co.uk/house-prices/{area}.html",
                    wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)
    try:
        await page.click("button:has-text('Accept all')", timeout=3000)
    except Exception:
        pass
    links = await page.evaluate("""() =>
        [...new Set([...document.querySelectorAll('a[href*="/house-prices/details/"]')]
            .map(a => a.href))]
    """)
    print(f"[{area}] {len(links)} detail links")
    out = []
    for url in links[:PER_AREA]:
        try:
            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_timeout(1800)
            html = await page.content()
            photos, plans = _unique_media(html)
            m = re.search(r"<h1[^>]*>([^<]+)</h1>", html)
            address = m.group(1).strip() if m else url
            is_flat = "flat" in address.lower() or "apartment" in address.lower()
            out.append({"address": address, "url": url, "photos": photos,
                        "floorplans": plans, "house": not is_flat})
            print(f"  photos={photos:2} plans={plans} {'house' if not is_flat else 'flat '} | {address}")
        except Exception as e:
            print(f"  skip {url}: {e!r}")
    return out


async def sv_coverage(address: str) -> bool:
    async with httpx.AsyncClient() as client:
        r = await client.get(SV_META_URL, params={
            "location": address, "key": GOOGLE_MAPS_API_KEY}, timeout=15)
        return r.json().get("status") == "OK"


async def main() -> None:
    areas = sys.argv[1:] or ["sw2", "se24", "n16"]
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        candidates: list[dict] = []
        for area in areas:
            candidates += await scout_area(page, area)
        await browser.close()

    keepers = [c for c in candidates if c["floorplans"] >= 1 and c["photos"] >= 8]
    keepers.sort(key=lambda c: (c["house"], c["photos"]), reverse=True)
    print(f"\n{'='*70}\nKEEPERS ({len(keepers)}) with floorplan + 8 or more photos, checking Street View\n{'='*70}")
    for c in keepers:
        c["streetview"] = await sv_coverage(c["address"])
        print(f"sv={'y' if c['streetview'] else 'N'} photos={c['photos']:2} "
              f"plans={c['floorplans']} {'house' if c['house'] else 'flat '} | {c['address']}")


if __name__ == "__main__":
    asyncio.run(main())
