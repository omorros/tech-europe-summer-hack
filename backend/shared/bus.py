"""Event bus, locked interface: bus.emit(type, payload) / bus.subscribe(type, handler).

TEMPORARY in-process version owned by Oriol's branch. Mykyta's real bus adds
WebSocket fan-out to console clients with the same call signatures; on merge
his file wins and the building lane needs no changes.
"""

import asyncio
import inspect
import json
import time
from collections import defaultdict
from typing import Any, Callable

_subscribers: dict[str, list[Callable]] = defaultdict(list)
_wildcard: list[Callable] = []


def subscribe(type: str, handler: Callable) -> None:
    """Register a handler for an event type. '*' receives everything."""
    if type == "*":
        _wildcard.append(handler)
    else:
        _subscribers[type].append(handler)


def emit(type: str, payload: dict[str, Any]) -> None:
    """Fan out {type, ts, payload} to subscribers. Safe to call from async code."""
    event = {"type": type, "ts": time.time(), "payload": payload}
    preview = json.dumps(payload, default=str)
    print(f"[bus] {type} {preview[:200]}{'…' if len(preview) > 200 else ''}")
    for handler in _subscribers[type] + _wildcard:
        result = handler(event)
        if inspect.isawaitable(result):
            asyncio.ensure_future(result)
