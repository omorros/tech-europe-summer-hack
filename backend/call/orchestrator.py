"""One incident at a time: a spoken or typed address becomes bus events.

Cache-first against backend/cache/<slug> so a demo address that matches a
warmed property (22 Kellett Road, 14 Deerdale Road, …) assembles instantly.
Unknown addresses fall through to the live building + intelligence lanes.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from building import build_room_graph, find_approach, find_property, reconstruct
from building.config import CACHE_DIR, STATIC_DIR
from building.golden import load_cached, save_cached, slugify
from building.reconstruct import set_address
from intelligence import make_briefing, on_transcript, plan_route
from intelligence import director, walkthrough
from intelligence.extractor import reset as reset_extractor
from intelligence.route import _match_room
from shared import bus

CALL_LINES = [
    "hello there's a fire please help",
    "we're at {address}",
    "my mum's still inside she's upstairs in the back bedroom she can't walk",
    "it started in the kitchen there's a gas bottle by the cooker",
    "the stairs are full of smoke and the back door's blocked",
]

DEFAULT_ADDRESS = "22 Kellett Road, London SW2 1EB"

AGENT_STUB_STEPS = (
    ("navigate", "Opening the sold-prices search"),
    ("type", "Entering the postcode"),
    ("click", "Selecting the matching address"),
    ("extract", "Saving interior photos and the floor plan"),
)


def resolve_address(address: str) -> str:
    """Map a short typed address onto a warmed cache folder when we have one."""
    raw = (address or "").strip() or DEFAULT_ADDRESS
    slug = slugify(raw)
    exact = CACHE_DIR / slug
    if exact.is_dir():
        return _address_from_cache(exact) or raw

    try:
        folders = [f for f in CACHE_DIR.iterdir() if f.is_dir()]
    except OSError:
        return raw
    matches = [
        folder for folder in folders
        if folder.name.startswith(slug) or slug.startswith(folder.name)
    ]
    if len(matches) == 1:
        return _address_from_cache(matches[0]) or raw

    # A spoken address carries the postcode but not the town, and the cache
    # folders carry both: "14-deerdale-road-se24-0aw" is neither a prefix nor
    # an extension of "14-deerdale-road-london-se24-0aw", so the check above
    # misses and the whole run goes live - the agent launches Playwright for a
    # property we already have on disk. Match on the house number and street
    # instead, which is what actually identifies the building.
    key = _street_key(slug)
    if key:
        near = [folder for folder in folders if _street_key(folder.name) == key]
        if len(near) == 1:
            return _address_from_cache(near[0]) or raw
    return raw


def _street_key(slug: str) -> str:
    """Number and street, before any town or postcode. "22-kellett-road"."""
    parts = [p for p in slug.split("-") if p]
    return "-".join(parts[:3]) if len(parts) >= 3 else ""


def _address_from_cache(folder: Path) -> str | None:
    artifacts = folder / "artifacts.json"
    if not artifacts.is_file():
        return None
    try:
        data = json.loads(artifacts.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    value = data.get("address")
    return value if isinstance(value, str) and value.strip() else None


class Orchestrator:
    def __init__(self) -> None:
        self._generation = 0
        self._script: asyncio.Task[None] | None = None
        self._lanes: asyncio.Task[None] | None = None
        self._walk: asyncio.Task[None] | None = None
        self._briefing_lock = asyncio.Lock()
        self.call_id: str | None = None
        self.address: str | None = None
        self.entities: list[dict] = []
        # The handset records in fixed-length chunks, so one spoken sentence
        # can arrive as two fragments: "we're at 22 Kellett Road" then "London
        # SW2 1EB". The street pattern needs both in the same string, so
        # extraction runs over a short rolling window while the record still
        # prints each fragment as it was said.
        self._recent_caller: deque[str] = deque(maxlen=3)
        self.approach: dict | None = None
        self.artifacts: dict | None = None
        self.graph: dict | None = None
        self.route: dict | None = None
        self.briefing: dict | None = None
        self._lanes_started = False
        self._walk_started = False
        self._walk_urls: tuple[str, ...] = ()
        self._briefed = False
        self._ended = False
        self._brief_at = -1

    # ---------------------------------------------------------------- run state

    def _bump(self) -> int:
        for task in (self._script, self._lanes, self._walk):
            if task and not task.done():
                task.cancel()
        self._generation += 1
        self._script = None
        self._lanes = None
        self._walk = None
        self.call_id = None
        self.address = None
        self.entities = []
        self.approach = None
        self.artifacts = None
        self.graph = None
        self.route = None
        self.briefing = None
        self._lanes_started = False
        self._walk_started = False
        self._walk_urls = ()
        self._briefed = False
        self._ended = False
        self._brief_at = -1
        reset_extractor()
        self._recent_caller.clear()
        bus.clear_recent()
        return self._generation

    def _alive(self, generation: int) -> bool:
        return generation == self._generation

    @staticmethod
    def _spawn(label: str, coro: Any) -> asyncio.Task[None]:
        """Background work nobody awaits. Without this, a failure inside the
        script or the lanes would surface only as a warning at collection
        time, long after the console needed to know."""

        async def guarded() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[orchestrator] {label} failed: {exc!r}")

        return asyncio.create_task(guarded())

    def _start_lanes(self, generation: int, address: str) -> None:
        """Claim the lane run synchronously.

        The flag must be set here, not inside the task: a growing address
        ("23 lark" → "23 larkfield road") fires ADDRESS more than once, and
        two lane runs means two agent sessions and two sets of paid API calls.
        """
        if self._lanes_started:
            return
        self._lanes_started = True
        self.address = address
        self._lanes = self._spawn("lanes", self._run_lanes(generation, address))

    # -------------------------------------------------------------- entry points

    async def start_incident(self, address: str | None = None, *, scripted: bool = True) -> dict:
        """Open a call and (optionally) play the scripted 999 through the extractor."""
        generation = self._bump()
        resolved = resolve_address(address) if address else None
        if scripted and resolved is None:
            resolved = resolve_address(DEFAULT_ADDRESS)
        self.call_id = f"999-{uuid.uuid4().hex[:6]}"
        self.address = resolved

        bus.emit("status", {"stage": "call", "state": "running", "message": "Line open"})
        bus.emit("call.incoming", {"call_id": self.call_id})
        bus.emit("call.answered", {"call_id": self.call_id})

        if resolved:
            self._start_lanes(generation, resolved)
            if scripted:
                self._script = self._spawn("script", self._play_script(generation, resolved))

        return {"call_id": self.call_id, "address": resolved}

    async def ingest_transcript(
        self,
        text: str,
        *,
        seq: int = 0,
        is_final: bool = True,
        speaker: str = "caller",
    ) -> list[dict]:
        if not self.call_id:
            await self.start_incident(scripted=False)
        generation = self._generation
        fragment = {
            "call_id": self.call_id,
            "seq": seq,
            "text": text,
            "is_final": is_final,
            "speaker": speaker,
        }
        bus.emit("transcript.fragment", fragment)

        extract_text = text
        if speaker == "caller":
            extract_text = " ".join([*self._recent_caller, text]).strip()
            if is_final:
                self._recent_caller.append(text)
        # The record gets the fragment; the extractor gets the window. The
        # dedupe in extractor._Dedupe stops the overlap re-firing entities.
        fired = await on_transcript({**fragment, "text": extract_text})
        if not self._alive(generation):
            return fired
        self.entities.extend(fired)

        if not self._lanes_started:
            spoken = next(
                (e["value"] for e in reversed(self.entities) if e["type"] == "ADDRESS"), None
            )
            if spoken:
                self._start_lanes(generation, resolve_address(spoken))

        # Route replanning is a cheap BFS, so it follows every new hazard.
        # The briefing is not, so it runs once here — a caller who never hangs
        # up still gets a crew card — and again at the end if more was said.
        if self.graph and any(
            e["type"] in ("VICTIM_LOCATION", "FIRE_ORIGIN", "HAZARD_TYPE", "EXIT") for e in fired
        ):
            await self._try_route()
            await self._try_briefing()
        return fired

    async def end_call(self) -> None:
        # Idempotent: the script ends the call, and so does a handset hanging
        # up. Twice would mean two "caller hung up" lines and a second paid
        # briefing render for the same information.
        if not self.call_id or self._ended:
            return
        self._ended = True
        bus.emit("call.ended", {"call_id": self.call_id})
        bus.emit("status", {"stage": "call", "state": "done", "message": "Caller hung up"})
        # Everything the caller said is in now, so this is the brief that counts.
        await self._try_briefing(force=True)

    async def on_radio(self, text: str) -> list[dict]:
        bus.emit("radio.update", {"text": text})
        generation = self._generation
        fired = await on_transcript({"text": text, "source": "radio"})
        if not self._alive(generation):
            return fired
        self.entities.extend(fired)
        if self.graph:
            await self._try_route()
            await self._try_briefing(force=True)
        return fired

    # ------------------------------------------------------------------ the run

    async def _play_script(self, generation: int, address: str) -> None:
        for seq, template in enumerate(CALL_LINES):
            if not self._alive(generation):
                return
            await self.ingest_transcript(template.format(address=address.lower()), seq=seq)
            await asyncio.sleep(1.4)
        if self._alive(generation):
            await self.end_call()

    async def _run_lanes(self, generation: int, address: str) -> None:
        set_address(address)
        await asyncio.gather(
            self._approach_job(generation, address),
            self._property_job(generation, address),
        )
        if not self._alive(generation) or not self.artifacts:
            return

        if not await self._rooms_job(generation, address):
            return

        await self._scene_job(generation)
        await self._try_route()
        if self._alive(generation):
            await self._try_briefing()

    @staticmethod
    def _approach_images_present(approach: dict) -> bool:
        """Does the cached approach still have its pictures on this machine?

        `backend/.gitignore` excludes static/approach/ as per-run noise, so a
        fresh clone has approach.json pointing at files that do not exist. The
        cache then looks like a hit and the console shows the headline panel as
        a row of 404s. Treat a cache with no images as a miss and re-fetch.
        """
        served = [frame.get("url") for frame in approach.get("streetview") or []]
        served.append(approach.get("satellite_url"))
        names = [url.split("/")[-1] for url in served if url]
        if not names:
            return False
        return all((STATIC_DIR / "approach" / name).exists() for name in names)

    async def _approach_job(self, generation: int, address: str) -> None:
        bus.emit("status", {"stage": "approach", "state": "running", "message": "Reading the street"})
        cached = load_cached(address, "approach")
        if cached and not self._approach_images_present(cached):
            print("[approach] cached JSON points at images not on disk; re-fetching")
            cached = None
        if cached:
            self.approach = cached
            bus.emit("approach.ready", cached)
            bus.emit("status", {"stage": "approach", "state": "done", "message": "Cached Street View"})
            return
        try:
            approach = await find_approach(address)
        except Exception as exc:
            bus.emit("status", {"stage": "approach", "state": "error", "message": str(exc)[:200]})
            return
        if self._alive(generation):
            self.approach = approach
            bus.emit("status", {"stage": "approach", "state": "done", "message": "Approach read"})

    async def _property_job(self, generation: int, address: str) -> None:
        bus.emit("status", {"stage": "agent", "state": "running", "message": "Opening the listing"})
        cached = load_cached(address, "artifacts")
        if cached:
            for step, (action, thought) in enumerate(AGENT_STUB_STEPS, start=1):
                if not self._alive(generation):
                    return
                bus.emit("agent.step", {
                    "step": step, "action": action, "thought": thought, "screenshot_url": "",
                })
                await asyncio.sleep(0.35)
            self.artifacts = cached
            bus.emit("agent.artifacts", cached)
            bus.emit("status", {"stage": "agent", "state": "done", "message": "Cached listing"})
            return
        try:
            artifacts = await find_property(address)
        except Exception as exc:
            bus.emit("status", {"stage": "agent", "state": "error", "message": str(exc)[:200]})
            return
        if self._alive(generation):
            self.artifacts = artifacts
            bus.emit("status", {"stage": "agent", "state": "done", "message": "Listing captured"})

    async def _rooms_job(self, generation: int, address: str) -> bool:
        bus.emit("status", {"stage": "rooms", "state": "running", "message": "Reading the floor plan"})
        cached = load_cached(address, "rooms")
        if cached:
            self.graph = cached
            bus.emit("rooms.graph", cached)
            bus.emit("status", {"stage": "rooms", "state": "done", "message": "Cached room graph"})
            return True
        try:
            graph = await build_room_graph(self.artifacts)
        except Exception as exc:
            bus.emit("status", {"stage": "rooms", "state": "error", "message": str(exc)[:200]})
            return False
        if not self._alive(generation) or not graph:
            return False
        self.graph = graph
        bus.emit("status", {"stage": "rooms", "state": "done", "message": "Room graph ready"})
        return True

    async def _scene_job(self, generation: int) -> None:
        if not self._alive(generation) or not (self.graph and self.artifacts):
            return
        photo_map = self.graph.get("photo_room_map") or {}
        photo = next(
            (p for p in (self.artifacts.get("photos") or [])
             if p.get("room_id") or p.get("id") in photo_map),
            None,
        )
        if not photo:
            return
        bus.emit("status", {"stage": "scene", "state": "running", "message": "Reconstructing a room"})
        try:
            room_id = photo.get("room_id") or photo_map.get(photo.get("id", ""), "")
            if not room_id:
                return
            await reconstruct(room_id, photo)
            bus.emit("status", {"stage": "scene", "state": "done", "message": "Scene ready"})
        except Exception as exc:
            bus.emit("status", {"stage": "scene", "state": "error", "message": str(exc)[:200]})

    async def _try_route(self) -> None:
        if not self.graph:
            return
        victim = next((e for e in reversed(self.entities) if e["type"] == "VICTIM_LOCATION"), None)
        if victim is None:
            return
        hazards = [e for e in self.entities if e["type"] in ("FIRE_ORIGIN", "HAZARD_TYPE", "EXIT")]
        bus.emit("status", {"stage": "route", "state": "running", "message": "Planning entry"})
        try:
            self.route = await plan_route(self.graph, victim, hazards, self.approach)
            bus.emit("status", {"stage": "route", "state": "done", "message": "Route planned"})
        except Exception as exc:
            bus.emit("status", {"stage": "route", "state": "error", "message": str(exc)[:200]})

    def _needs_brief(self, force: bool) -> bool:
        if not self.route:
            return False
        if not self._briefed:
            return True
        # A forced rebrief is only worth the work if something was said since
        # the last one: hanging up on its own does not change the card.
        return force and len(self.entities) != self._brief_at

    async def _try_briefing(self, *, force: bool = False) -> None:
        if not self._needs_brief(force):
            return
        # One at a time: a radio update landing mid-render would otherwise
        # write a second crew card over the first.
        async with self._briefing_lock:
            if not self._needs_brief(force):
                return
            generation = self._generation
            bus.emit("status", {"stage": "briefing", "state": "running",
                                "message": "Writing the crew card"})
            try:
                briefing = await make_briefing({
                    "address": self.address or DEFAULT_ADDRESS,
                    "entities": self.entities,
                    "approach": self.approach,
                    "route": self.route,
                    "room_graph": self.graph,
                })
            except Exception as exc:
                bus.emit("status", {"stage": "briefing", "state": "error", "message": str(exc)[:200]})
                return
            if not self._alive(generation):
                return
            self._briefed = True
            self._brief_at = len(self.entities)
            coverage = self._coverage()
            if coverage:
                # make_briefing already emitted; re-emit with the honesty block
                # attached so the console can say "1 of 4 rooms photographed".
                briefing = {**briefing, "coverage": coverage}
            # Keep the clips. The caller hanging up writes a fresh crew card,
            # and a rebuild that dropped `legs` took the walkthrough off the
            # video page seconds after it had arrived - the render succeeded
            # and the screen went black anyway.
            legs = (self.briefing or {}).get("legs")
            if legs:
                briefing = {**briefing, "legs": legs}
            if coverage or legs:
                bus.emit("briefing.ready", briefing)
            self.briefing = briefing
            bus.emit("status", {"stage": "briefing", "state": "done", "message": "Crew card ready"})
            self._start_walkthrough(generation)

    # ------------------------------------------------------------ walkthrough

    def _start_walkthrough(self, generation: int) -> None:
        """Claim the render synchronously.

        A radio update rewrites the crew card, and the card is what triggers
        this. Without the flag set here rather than inside the task, a second
        card during the same call would pay fal twice for the same walk.
        """
        if self._walk_started:
            return
        self._walk_started = True
        self._walk = self._spawn("walkthrough", self._walkthrough_job(generation))

    def _fire_room(self) -> str | None:
        fire = next((e["value"] for e in reversed(self.entities)
                     if e["type"] == "FIRE_ORIGIN"), None)
        return _match_room(self.graph, fire) if (fire and self.graph) else None

    async def _walkthrough_job(self, generation: int) -> None:
        """One unbroken clip, the front of the building to the seat of the fire.

        Deliberately a single fal generation rather than a clip per doorway
        stitched together: a crew watching the approach should see one walk,
        not a playlist that cuts every few seconds.
        """
        if not (self.graph and self.artifacts and self.route):
            return
        address = self.address or DEFAULT_ADDRESS
        fire_room = self._fire_room()

        # A render costs real money and takes minutes, so a walk we have
        # already paid for at this address is reused as-is.
        #
        # The fire room is a preference, not a condition. The walkthrough can
        # be triggered before the caller has said where the fire is, and on a
        # projected screen a cached walk of the right building beats two
        # minutes of black waiting for fal. The status says which case it is.
        cached = load_cached(address, "walkthrough")
        if isinstance(cached, dict) and cached.get("legs"):
            same_fire = cached.get("fire_room") == fire_room
            self._publish_walk(generation, cached["legs"])
            bus.emit("status", {
                "stage": "briefing", "state": "done",
                "message": "Cached walkthrough" if same_fire
                else f"Cached walkthrough (rendered for the {cached.get('fire_room') or 'route'})",
            })
            return
        if not walkthrough.available():
            return

        hazards = [e["value"] for e in self.entities
                   if e["type"] in ("FIRE_ORIGIN", "HAZARD_TYPE", "EXIT")]
        approach = self.approach or {}
        payload = walkthrough.build_payload(
            self.route, self.graph, self.artifacts,
            approach=self.approach, hazards=hazards, fire_room=fire_room,
            continuous=True,
            # Kling tops out at 10s of output, so ask for all of it: the walk
            # is one continuous take and the video page loops it, so the
            # longest clip the model will make is the one we want.
            seconds_per_leg=int(os.environ.get("LANTERN_WALK_SECONDS", "10")),
            building_description=f"{approach.get('building_type', 'house')}, "
                                 f"{approach.get('storeys', '')} storeys".strip(", "),
        )
        prompts = await director.direct_continuous(
            address=address, approach=self.approach, graph=self.graph,
            artifacts=self.artifacts, hazards=hazards, walk=payload["route"],
            fire_room=fire_room,
        )
        if prompts:
            payload["leg_prompts"] = prompts
        if not self._alive(generation):
            return

        bus.emit("status", {"stage": "briefing", "state": "running",
                            "message": "Rendering the walkthrough"})
        job = await walkthrough.start(payload)
        state = await walkthrough.wait(
            job["job_id"], poll_s=8.0,
            on_progress=lambda live: self._publish_walk(generation, live.get("legs") or []),
        )
        legs = [leg for leg in state.get("legs") or [] if leg.get("video_url")]
        if not legs:
            bus.emit("status", {"stage": "briefing", "state": "error",
                                "message": "Walkthrough render produced no video"})
            return
        if not self._alive(generation):
            return
        save_cached(address, "walkthrough", {"fire_room": fire_room, "legs": legs})
        self._publish_walk(generation, legs)
        bus.emit("status", {"stage": "briefing", "state": "done",
                            "message": "Walkthrough ready"})

    def _publish_walk(self, generation: int, legs: list[dict]) -> None:
        """Put the clips on the crew card the console is already showing."""
        playable = [leg for leg in legs if leg.get("video_url")]
        if not playable or not self._alive(generation):
            return
        # The poll loop calls this every few seconds with the same answer once
        # the clip has landed; the console only needs telling when it changes.
        urls = tuple(leg["video_url"] for leg in playable)
        if urls == self._walk_urls:
            return
        self._walk_urls = urls
        self.briefing = {**(self.briefing or {}), "legs": playable}
        bus.emit("briefing.ready", self.briefing)

    def _coverage(self) -> dict[str, Any] | None:
        """How much of the route was actually photographed.

        Deliberately does not call walkthrough.build_payload: that base64
        inlines every photo for the render request, which is hundreds of
        kilobytes of work we do not need to print one honest sentence.
        """
        if not (self.graph and self.artifacts and self.route):
            return None
        rooms = {r["id"]: r for r in self.graph.get("rooms", [])}
        photo_map = self.graph.get("photo_room_map") or {}
        photographed: set[str] = set()
        for photo in self.artifacts.get("photos") or []:
            if not photo.get("url"):
                continue
            room_id = photo.get("room_id") or photo_map.get(photo.get("id") or "")
            if room_id:
                photographed.add(room_id)

        route_rooms: list[str] = []
        for waypoint in self.route.get("waypoints", []):
            room_id = waypoint.get("room_id")
            if room_id and room_id not in route_rooms:
                route_rooms.append(room_id)
        return {
            "route_rooms": len(route_rooms),
            "with_imagery": sum(1 for r in route_rooms if r in photographed),
            "missing": [rooms.get(r, {}).get("name", r) for r in route_rooms
                        if r not in photographed],
            "opens_on_street_view": bool(
                (self.approach or {}).get("coverage")
                and (self.approach or {}).get("streetview")
            ),
            "photographed_total": len(photographed),
        }


orchestrator = Orchestrator()
