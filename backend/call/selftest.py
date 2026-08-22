"""Keys-free smoke test of the transport layer.

    uv run python -m call.selftest

Drives a real incident through the console WebSocket handler and asserts the
things the frontend depends on that a browser cannot easily prove:

  * every frame carries a strictly increasing `seq`, and a console that
    reconnects is replayed the same numbers, so it can drop what it has
    already applied instead of double-printing the record
  * a growing address ("22 kell" → "22 kellett road") fires ADDRESS more than
    once but must start the paid lanes exactly once
  * a malformed frame does not take the socket down
  * radio traffic sent up the socket reaches the orchestrator
  * a closed console is released, and a console that never reads is bounded
    rather than growing the server's memory forever

No keys and no network: the credentials are blanked before the lanes load, so
this costs nothing to run, and the golden cache answers both building lanes.
"""

from __future__ import annotations

import asyncio
import json
import os

# Before any lane imports: dotenv does not override what is already set, so
# blanking here keeps a developer's real .env out of a test that would
# otherwise spend money on the briefing render.
for _name in (
    "OPENAI_API_KEY", "PIONEER_API_KEY", "GOOGLE_MAPS_API_KEY", "HAI_API_KEY",
    "FAL_KEY", "SIZEUP_WORKER_URL", "WORKER_URL", "SIZEUP_WORKER_TOKEN",
    "WORKER_TOKEN", "SIZEUP_AVATAR_URL", "SIZEUP_AVATAR_ID", "AVATAR_ID",
):
    os.environ[_name] = ""

import server  # noqa: E402  (must follow the blanking above)
from shared import bus  # noqa: E402

from .orchestrator import orchestrator  # noqa: E402

ADDRESS = "22 Kellett Road"


class FakeConsole:
    """Stands in for Starlette's WebSocket: accept / send_json / receive.

    Driving the handler directly keeps the test in one event loop, so every
    wait has a timeout and a failure is a message rather than a hung job.
    """

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.inbound: asyncio.Queue[dict] = asyncio.Queue()

    async def accept(self) -> None:
        return None

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)

    async def receive(self) -> dict:
        return await self.inbound.get()

    # -- test-side helpers

    def send(self, raw: str) -> None:
        self.inbound.put_nowait({"type": "websocket.receive", "text": raw})

    def disconnect(self) -> None:
        self.inbound.put_nowait({"type": "websocket.disconnect", "code": 1000})

    def count(self, type: str) -> int:
        return sum(1 for frame in self.sent if frame["type"] == type)

    async def wait_for(self, type: str, *, count: int = 1, timeout: float = 30) -> None:
        async def poll() -> None:
            while self.count(type) < count:
                await asyncio.sleep(0.05)

        try:
            await asyncio.wait_for(poll(), timeout)
        except asyncio.TimeoutError:
            raise AssertionError(
                f"waited {timeout}s for {count}× {type!r}; saw "
                f"{sorted({f['type'] for f in self.sent})}"
            ) from None


async def main() -> None:
    console = FakeConsole()
    handler = asyncio.create_task(server.ws_console(console))
    await console.wait_for("_hello", timeout=5)

    hello = console.sent[0]
    assert hello["boot"] == bus.BOOT, "hello must name this process"

    # Neither of these is a message the server understands. Both must be
    # dropped without closing the connection.
    console.send("{ not json at all")
    console.send('{"type": "something.unknown"}')

    print(f"== incident ==  {ADDRESS}")
    started = await orchestrator.start_incident(ADDRESS)
    assert started["call_id"], "no call_id"
    print(f"  call {started['call_id']} at {started['address']}")

    await console.wait_for("call.ended", timeout=60)
    await console.wait_for("briefing.ready", timeout=30)

    # The lanes cost money, so the count is the assertion that matters.
    lane_starts = [
        f for f in console.sent
        if f["type"] == "status"
        and f["payload"].get("stage") == "agent"
        and f["payload"].get("state") == "running"
    ]
    assert len(lane_starts) == 1, f"lanes started {len(lane_starts)}×, must be once"
    assert console.count("agent.artifacts") == 1, "listing captured more than once"
    print(f"  lanes ran once across {console.count('entity.extracted')} entities")

    # One card while the call is live, one when it ends and more has been said.
    # Any more than that is a paid render per transcript fragment.
    brief_runs = sum(
        1 for f in console.sent
        if f["type"] == "status"
        and f["payload"].get("stage") == "briefing"
        and f["payload"].get("state") == "running"
    )
    assert 1 <= brief_runs <= 2, f"briefing ran {brief_runs}×, must not run per fragment"
    print(f"  briefing ran {brief_runs}× for the whole call")

    frames = list(console.sent)
    seqs = [f["seq"] for f in frames[1:]]
    assert seqs == sorted(seqs), "frames arrived out of order"
    assert len(set(seqs)) == len(seqs), "duplicate seq on one connection"
    assert all(f["boot"] == bus.BOOT for f in frames[1:]), "boot changed mid-run"
    print(f"  {len(seqs)} frames, seq {seqs[0]}–{seqs[-1]}, in order")

    coverage = next(
        (f["payload"]["coverage"] for f in reversed(frames)
         if f["type"] == "briefing.ready" and f["payload"].get("coverage")),
        None,
    )
    assert coverage, "briefing.ready never carried a coverage block"
    assert coverage["route_rooms"] >= 1, "route had no rooms"
    assert coverage["with_imagery"] <= coverage["route_rooms"], "coverage over-counts"
    print(f"  coverage {coverage['with_imagery']}/{coverage['route_rooms']} route rooms"
          f" photographed, {coverage['photographed_total']} in the listing")

    # Radio traffic travels up the same socket.
    briefings = console.count("briefing.ready")
    console.send(json.dumps({
        "type": "radio.update",
        "payload": {"text": "flashover in the kitchen, rear exit blocked"},
    }))
    await console.wait_for("radio.update", timeout=10)
    await console.wait_for("briefing.ready", count=briefings + 1, timeout=30)
    print("  radio update replanned and re-briefed")

    # A second console must be replayed the backlog, and every number in it
    # must be one the first console already has — that is what lets the
    # reconnecting client drop the replay instead of duplicating the record.
    latest = console.sent[-1]["seq"]
    replayed = FakeConsole()
    second = asyncio.create_task(server.ws_console(replayed))
    await replayed.wait_for("briefing.ready", timeout=10)
    replay_seqs = [f["seq"] for f in replayed.sent[1:]]
    assert replay_seqs == sorted(replay_seqs), "backlog replayed out of order"
    assert all(s <= latest for s in replay_seqs), "backlog contained unseen frames"
    assert replayed.sent[0]["type"] == "_hello", "replay must open with hello"
    print(f"  reconnect replayed {len(replay_seqs)} frames, all already seen")

    # A console nobody reads is bounded, not a slow leak.
    idle = bus.attach_console(FakeConsole())
    for n in range(bus.MAX_QUEUED + 25):
        idle.offer({"seq": n, "boot": bus.BOOT, "type": "noise", "ts": 0, "payload": {}})
    assert idle.queued == bus.MAX_QUEUED, f"queue grew to {idle.queued}"
    bus.detach_console(idle)

    attached = bus.consoles()
    console.disconnect()
    replayed.disconnect()
    await asyncio.wait_for(asyncio.gather(handler, second), timeout=10)
    assert bus.consoles() == attached - 2, f"{bus.consoles()} consoles still attached"
    print(f"  queue capped at {bus.MAX_QUEUED}, both consoles released")

    print("transport OK")


if __name__ == "__main__":
    asyncio.run(main())
