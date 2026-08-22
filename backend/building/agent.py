"""H agent: address -> property listing -> gallery + floor plan.

Loop per H's agent-loop recipe (hub.hcompany.ai/agent-loop.md): screenshot
wrapped in <observation> tags -> Holo structured output {note, thought,
tool_call} -> execute via Playwright -> repeat. Max 3 screenshots kept in
context; coordinates arrive normalized to [0, 1000] and are scaled to the
viewport. Holo handles navigation; once it answers with the listing URL,
deterministic DOM extraction pulls the gallery and floor plan.

Degradation: no HAI key or any failure -> cached golden-property replay with
narrated stub steps, so the console pipeline never breaks.
"""

import asyncio
import base64
import json
import re
import time

import httpx
from openai import AsyncOpenAI
from playwright.async_api import async_playwright
from pydantic import BaseModel

from shared import bus
from shared.types import Artifacts, Photo

from .config import HAI_API_KEY, HOLO_BASE_URL, HOLO_MODEL, STATIC_DIR
from .golden import load_cached, save_cached, slugify

VIEWPORT = {"width": 1280, "height": 800}
MAX_STEPS = 30
MAX_SECONDS = 300
MAX_IMAGES_IN_CONTEXT = 3
START_URL = "https://www.rightmove.co.uk/house-prices.html"


class ToolArguments(BaseModel):
    x: int | None = None          # click position, [0, 1000] grid
    y: int | None = None
    text: str | None = None       # type_text
    key: str | None = None        # press_key, e.g. "Enter"
    dy: int | None = None         # scroll, positive = down
    url: str | None = None        # goto_url
    content: str | None = None    # answer


class ToolCall(BaseModel):
    tool_name: str
    arguments: ToolArguments


class Step(BaseModel):
    note: str
    thought: str
    tool_call: ToolCall


SYSTEM_PROMPT = """You are a web navigation agent helping the fire service.
Task: find the historical property listing for this address in the Rightmove
sold-prices section: {address}

The search box only accepts a postcode or a street name, never a full
address: type just the postcode (for the address above that means the last
part, like "SW2 1EB"), press Enter or click Search, then find the matching
street and house number in the results and open its most recent sold listing
page (the page with the photo gallery and floor plan). Accept or dismiss any
cookie consent dialog first.

When you are on the listing page for the correct property, call the answer
tool with the current page URL as content. If you are certain the property
cannot be found, answer with content "NOT_FOUND".

Available tools:
- goto_url(url): navigate the browser to a URL
- click(x, y): click at a position; coordinates are integers in [0, 1000]
  normalized to the screenshot
- type_text(text): type into the currently focused element
- press_key(key): press a keyboard key, e.g. "Enter"
- scroll(dy): scroll vertically by dy pixels, positive is down
- go_back(): browser back
- answer(content): finish the task

Respond with one JSON object per turn: note (short human-readable action
label), thought (one sentence of reasoning a bystander can follow), tool_call
{{tool_name, arguments}}.

<output_format>
```json
{schema}
```
</output_format>"""


async def find_property(address: str) -> Artifacts:
    if HAI_API_KEY:
        try:
            artifacts = await asyncio.wait_for(_run_agent(address), timeout=MAX_SECONDS)
            save_cached(address, "artifacts", artifacts)
            bus.emit("agent.artifacts", artifacts)
            return artifacts
        except Exception as e:
            print(f"[agent] live run failed: {e!r}, falling back to cache")
            bus.emit("status", {"stage": "agent", "state": "error", "message": str(e)})
    return await _replay_cached(address)


async def _run_agent(address: str) -> Artifacts:
    holo = AsyncOpenAI(api_key=HAI_API_KEY, base_url=HOLO_BASE_URL)
    schema = Step.model_json_schema()
    system = SYSTEM_PROMPT.format(address=address, schema=json.dumps(schema))
    messages: list[dict] = [{"role": "system", "content": system}]
    shots_dir = STATIC_DIR / "agent"
    shots_dir.mkdir(parents=True, exist_ok=True)
    run_id = int(time.time())

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        page = await browser.new_page(viewport=VIEWPORT)
        await page.goto(START_URL, wait_until="domcontentloaded")

        try:
            for step_n in range(1, MAX_STEPS + 1):
                await page.wait_for_timeout(800)  # let the page settle post-action
                png = await page.screenshot()
                shot_name = f"{run_id}-step{step_n:02d}.png"
                (shots_dir / shot_name).write_bytes(png)
                b64 = base64.b64encode(png).decode()
                messages.append({"role": "user", "content": [
                    {"type": "text", "text": "<observation>\n"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": "\n</observation>"},
                ]})
                _evict_old_screenshots(messages)

                resp = await holo.chat.completions.create(
                    model=HOLO_MODEL,
                    messages=messages,
                    temperature=0.8,
                    extra_body={"structured_outputs": {"json": schema}},
                )
                step = Step.model_validate_json(resp.choices[0].message.content)
                messages.append({"role": "assistant", "content": step.model_dump_json()})

                bus.emit("agent.step", {
                    "step": step_n,
                    "action": step.note,
                    "thought": step.thought,
                    "screenshot_url": f"/static/agent/{shot_name}",
                })

                call = step.tool_call
                if call.tool_name == "answer":
                    if (call.arguments.content or "") == "NOT_FOUND":
                        raise RuntimeError("agent could not find the property")
                    # The browser knows where we are; the model's URL can be
                    # hallucinated, so never use it.
                    return await _extract_artifacts(page, address, page.url)

                result = await _execute(page, call)
                messages.append({
                    "role": "user",
                    "content": f'<tool_output tool="{call.tool_name}">\n{result}\n</tool_output>',
                })

            raise RuntimeError(f"agent hit the {MAX_STEPS}-step limit")
        finally:
            await browser.close()


def _evict_old_screenshots(messages: list[dict]) -> None:
    """Keep only the newest MAX_IMAGES_IN_CONTEXT screenshots (H's accuracy rule)."""
    image_idxs = [
        i for i, m in enumerate(messages)
        if isinstance(m.get("content"), list)
        and any(part.get("type") == "image_url" for part in m["content"])
    ]
    for i in image_idxs[:-MAX_IMAGES_IN_CONTEXT]:
        messages[i] = {"role": "user", "content": "[screenshot evicted]"}


_MODIFIERS = ("control", "ctrl", "alt", "shift", "meta", "cmd", "command")


def _normalize_key(key: str) -> str:
    """Map model key names ('ControlA', 'ctrl+a') to Playwright combos.

    Chromium on macOS wants Meta for the usual shortcuts, so Control-combos
    are translated when running on darwin.
    """
    import re
    import sys

    k = key.strip()
    m = re.fullmatch(
        r"(control|ctrl|alt|shift|meta|cmd|command)[+\- ]?(\w+)", k, re.IGNORECASE
    )
    if not m:
        return k if len(k) > 1 else k  # plain key like "Enter" or "a"
    mod, rest = m.group(1).lower(), m.group(2)
    mod_name = {
        "control": "Control", "ctrl": "Control", "alt": "Alt",
        "shift": "Shift", "meta": "Meta", "cmd": "Meta", "command": "Meta",
    }[mod]
    if mod_name == "Control" and sys.platform == "darwin":
        mod_name = "Meta"
    rest = rest.upper() if len(rest) == 1 else rest.capitalize()
    return f"{mod_name}+{rest}"


async def _execute(page, call: ToolCall) -> str:
    a = call.arguments
    match call.tool_name:
        case "goto_url":
            await page.goto(a.url, wait_until="domcontentloaded")
            return f"navigated to {a.url}"
        case "click":
            x = int(a.x / 1000 * VIEWPORT["width"])
            y = int(a.y / 1000 * VIEWPORT["height"])
            await page.mouse.click(x, y)
            return f"clicked ({x}, {y})"
        case "type_text":
            await page.keyboard.type(a.text, delay=30)
            return f"typed {a.text!r}"
        case "press_key":
            key = _normalize_key(a.key or "")
            await page.keyboard.press(key)
            return f"pressed {key}"
        case "scroll":
            await page.mouse.wheel(0, a.dy or 400)
            return f"scrolled {a.dy}"
        case "go_back":
            await page.go_back(wait_until="domcontentloaded")
            return "went back"
        case _:
            return f"unknown tool {call.tool_name}"


_MEDIA_RE = re.compile(r"https://media\.rightmove\.co\.uk/[^\"'\\\s)]+")
_HASH_RE = re.compile(r"/([0-9a-f]{16,})[^/]*\.(?:jpe?g|png|gif)$", re.IGNORECASE)


def _dedupe_best(urls: list[str]) -> list[str]:
    """One URL per underlying image, preferring the full-resolution variant.

    Rightmove serves each image at several sizes (`_max_296x197`, `/dir/`
    thumbnails); the same content hash appears in every variant's filename.
    """
    best: dict[str, tuple[int, str]] = {}
    for u in urls:
        m = _HASH_RE.search(u)
        key = m.group(1) if m else u
        score = ("_max_" in u) + ("/dir/" in u)
        if key not in best or score < best[key][0]:
            best[key] = (score, u)
    return [u for _, u in best.values()]


async def _extract_artifacts(page, address: str, listing_url: str) -> Artifacts:
    """Deterministic extraction once Holo is on the listing page.

    The gallery lazy-loads, so the DOM only holds a couple of images, but
    every media URL (photos and floor plans, all sizes) is present as a plain
    string in the page source. Regex beats fighting the React state format
    and works on both the old PAGE_MODEL pages and the new detail pages.
    """
    html = await page.content()
    urls = list(dict.fromkeys(_MEDIA_RE.findall(html)))
    photo_urls = _dedupe_best([u for u in urls if "property-photo" in u])
    floorplan_urls = _dedupe_best([u for u in urls if "floorplan" in u.lower() or "_flp" in u.lower()])
    gallery = [{"src": u, "alt": ""} for u in photo_urls]
    floorplan_url = floorplan_urls[0] if floorplan_urls else ""
    return await _download_artifacts(address, listing_url, gallery, floorplan_url)


async def _download_artifacts(
    address: str, listing_url: str, gallery: list[dict], floorplan_url: str
) -> Artifacts:
    slug = slugify(address)
    out_dir = STATIC_DIR / "artifacts" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    photos: list[Photo] = []
    async with httpx.AsyncClient(headers={"Referer": listing_url}) as client:
        for i, g in enumerate(gallery[:12], start=1):
            try:
                r = await client.get(g["src"], timeout=15)
                r.raise_for_status()
                name = f"photo-{i:02d}.jpg"
                (out_dir / name).write_bytes(r.content)
                photos.append({
                    "id": f"photo-{i:02d}",
                    "url": f"/static/artifacts/{slug}/{name}",
                    "caption": g["alt"],
                    "room_id": None,
                })
            except Exception as e:
                print(f"[agent] photo download failed: {e!r}")
        local_floorplan = ""
        if floorplan_url:
            try:
                r = await client.get(floorplan_url, timeout=15)
                r.raise_for_status()
                (out_dir / "floorplan.png").write_bytes(r.content)
                local_floorplan = f"/static/artifacts/{slug}/floorplan.png"
            except Exception as e:
                print(f"[agent] floorplan download failed: {e!r}")

    return {
        "address": address,
        "listing_url": listing_url,
        "floorplan_url": local_floorplan,
        "photos": photos,
    }


STUB_STEPS = [
    ("navigate", "Opening the property site's sold-prices search"),
    ("type", "Entering the postcode into the search box"),
    ("click", "Selecting the matching address from the results"),
    ("scroll", "Scanning the listing for the photo gallery"),
    ("extract", "Saving interior photos and the floor plan"),
]


async def _replay_cached(address: str) -> Artifacts:
    for i, (action, thought) in enumerate(STUB_STEPS, start=1):
        bus.emit("agent.step", {"step": i, "action": action, "thought": thought, "screenshot_url": ""})
        await asyncio.sleep(0.5)
    artifacts: Artifacts = load_cached(address, "artifacts") or {
        "address": address, "listing_url": "", "floorplan_url": "", "photos": [],
    }
    bus.emit("agent.artifacts", artifacts)
    return artifacts
