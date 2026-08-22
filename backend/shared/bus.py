"""Event bus, locked interface: bus.emit(type, payload) / bus.subscribe(type, handler).

In-process handlers stay as they were so every lane keeps working. Console
WebSocket clients attached via attach_console() receive the same
{type, ts, payload} JSON the frontend reducer already understands, plus two
additive envelope fields the transport needs:

  seq   monotonic per process. A reconnecting console replays the backlog and
        drops anything it has already applied, so a dropped socket does not
        double every line in the record.
  boot  identifies this process. If the backend restarts, seq restarts with
        it, and the client must forget the sequence it was tracking rather
        than discarding every event as already-seen.

Each console gets its own bounded queue drained by one writer task. That is
what keeps events in order: a task per event per socket would let two frames
race and arrive swapped, and concurrent sends on one WebSocket are not safe.
"""

import asyncio
import inspect
import json
import time
import uuid
from collections import deque
from typing import Any, Callable

_subscribers: dict[str, list[Callable]] = {}
_wildcard: list[Callable] = []
_clients: set["ConsoleClient"] = set()
_recent: deque[dict[str, Any]] = deque(maxlen=400)
_loop: asyncio.AbstractEventLoop | None = None
_tasks: set[asyncio.Task] = set()
_seq = 0

BOOT = uuid.uuid4().hex[:12]

# A console that stops reading must not grow the server's memory without
# bound. Past this the oldest frames are dropped; the client notices the gap
# in `seq` and the console keeps rendering rather than the process dying.
MAX_QUEUED = 1000


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Call from the FastAPI lifespan so emits from a worker thread can wake
    the socket writers."""
    global _loop
    _loop = loop


def subscribe(type: str, handler: Callable) -> None:
    """Register a handler for an event type. '*' receives everything."""
    if type == "*":
        _wildcard.append(handler)
    else:
        _subscribers.setdefault(type, []).append(handler)


class ConsoleClient:
    """One WebSocket's outbound queue plus the task that drains it."""

    def __init__(self, ws: Any) -> None:
        self._ws = ws
        self._pending: deque[dict[str, Any]] = deque(maxlen=MAX_QUEUED)
        self._wake = asyncio.Event()
        try:
            self._loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = _loop

    @property
    def queued(self) -> int:
        return len(self._pending)

    def offer(self, event: dict[str, Any]) -> None:
        """Queue an event. Sync and cheap so emit() never blocks a lane."""
        self._pending.append(event)
        loop = self._loop
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop or loop is None:
            self._wake.set()
        else:
            loop.call_soon_threadsafe(self._wake.set)

    async def pump(self) -> None:
        """Drain the queue in order until the socket dies or we are cancelled."""
        try:
            while True:
                if not self._pending:
                    self._wake.clear()
                    await self._wake.wait()
                    continue
                await self._ws.send_json(self._pending.popleft())
        except asyncio.CancelledError:
            raise
        except Exception:
            return


def attach_console(ws: Any) -> ConsoleClient:
    """Register a console and queue the backlog ahead of anything live.

    No await between building the backlog and joining the fan-out, so an
    event emitted in the meantime cannot slip past this client.
    """
    client = ConsoleClient(ws)
    for event in _recent:
        client.offer(event)
    _clients.add(client)
    return client


def detach_console(client: ConsoleClient) -> None:
    _clients.discard(client)


def consoles() -> int:
    """Attached consoles. Surfaced on /health so a socket that is never
    released shows up as a number rather than as creeping memory."""
    return len(_clients)


def hello() -> dict[str, Any]:
    """Sent once per connection so a client can spot a backend restart."""
    return {"type": "_hello", "boot": BOOT, "seq": _seq, "ts": time.time()}


def clear_recent() -> None:
    """New incident: drop the backlog. `seq` deliberately keeps climbing so a
    reconnecting console cannot mistake new events for ones it has seen."""
    _recent.clear()


def emit(type: str, payload: dict[str, Any]) -> None:
    """Fan out {seq, boot, type, ts, payload} to subscribers and consoles."""
    global _seq
    _seq += 1
    event = {
        "seq": _seq,
        "boot": BOOT,
        "type": type,
        "ts": time.time(),
        "payload": payload,
    }
    _recent.append(event)

    preview = json.dumps(payload, default=str)
    print(f"[bus] {type} {preview[:200]}{'…' if len(preview) > 200 else ''}")

    for handler in (*_subscribers.get(type, ()), *_wildcard):
        try:
            result = handler(event)
        except Exception as exc:
            print(f"[bus] handler for {type} failed: {exc!r}")
            continue
        if inspect.isawaitable(result):
            _spawn(result)

    for client in list(_clients):
        client.offer(event)


def _spawn(coro: Any) -> None:
    """Run an async subscriber, keeping a reference so it is not garbage
    collected mid-flight."""
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is not None:
        task = running.create_task(coro)
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        return
    if _loop is not None and _loop.is_running():
        asyncio.run_coroutine_threadsafe(coro, _loop)
        return
    coro.close()  # nothing can run it; closing avoids a bogus warning
