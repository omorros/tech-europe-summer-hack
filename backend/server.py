"""Lantern FastAPI process: static files, incident HTTP, WebSocket fan-out.

    cd backend
    uv run uvicorn server:app --host 0.0.0.0 --port 8000

The frontend talks to /ws/console (every bus event) and POST /incident
(address in → scripted 999 + lane pipeline). /phone uses /ws/phone.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from call.orchestrator import DEFAULT_ADDRESS, orchestrator
from intelligence.config import BACKEND_DIR
from shared import bus

STATIC_DIR = Path(BACKEND_DIR) / "static"
STATIC_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.set_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="Lantern", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IncidentIn(BaseModel):
    address: str = Field(default=DEFAULT_ADDRESS)
    replay: bool = False


class RadioIn(BaseModel):
    text: str


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "lantern-backend",
        "boot": bus.BOOT,
        "consoles": bus.consoles(),
        "call_id": orchestrator.call_id,
        "address": orchestrator.address,
    }


@app.post("/incident")
async def start_incident(body: IncidentIn) -> dict:
    address = DEFAULT_ADDRESS if body.replay else (body.address or DEFAULT_ADDRESS)
    return await orchestrator.start_incident(address, scripted=True)


@app.post("/radio")
async def radio(body: RadioIn) -> dict:
    fired = await orchestrator.on_radio(body.text)
    return {"ok": True, "entities": fired}


async def _receive(ws: WebSocket) -> dict[str, Any] | None:
    """One JSON object from the socket. None for a frame we cannot use — a
    malformed message should not take the connection down with it."""
    message = await ws.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    raw = message.get("text")
    if raw is None and message.get("bytes") is not None:
        raw = message["bytes"].decode("utf-8", "replace")
    try:
        parsed = json.loads(raw or "")
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _text_of(message: dict[str, Any]) -> str:
    payload = message.get("payload")
    if isinstance(payload, dict) and payload.get("text"):
        return str(payload["text"])
    return str(message.get("text") or "")


@app.websocket("/ws/console")
async def ws_console(ws: WebSocket) -> None:
    await ws.accept()
    # Sent before the backlog: it identifies the process, so a console that
    # reconnects after a restart forgets the sequence it was tracking.
    await ws.send_json(bus.hello())
    client = bus.attach_console(ws)
    tasks = {
        asyncio.create_task(client.pump()),
        asyncio.create_task(_console_reader(ws)),
    }
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            if task.cancelled():
                continue
            error = task.exception()
            if error and not isinstance(error, WebSocketDisconnect):
                print(f"[ws] console closed on {error!r}")
    finally:
        bus.detach_console(client)


async def _console_reader(ws: WebSocket) -> None:
    """The console only ever sends radio traffic back up the socket."""
    while True:
        message = await _receive(ws)
        if not message:
            continue
        if message.get("type") == "radio.update":
            text = _text_of(message)
            if text:
                await orchestrator.on_radio(text)


@app.websocket("/ws/phone")
async def ws_phone(ws: WebSocket) -> None:
    await ws.accept()
    next_seq = 0
    # The call this handset owns. A stale tab closing must not hang up on an
    # incident somebody else has since started.
    mine: str | None = None

    def owns_the_call() -> bool:
        return mine is not None and mine == orchestrator.call_id

    try:
        while True:
            message = await _receive(ws)
            if not message:
                continue
            kind = message.get("type")
            if kind == "call.start":
                payload = message.get("payload")
                address = message.get("address")
                if isinstance(payload, dict):
                    address = payload.get("address") or address
                await orchestrator.start_incident(address, scripted=False)
                mine = orchestrator.call_id
                next_seq = 0
                await ws.send_json({
                    "type": "ack",
                    "call_id": orchestrator.call_id,
                    "address": orchestrator.address,
                })
            elif kind == "transcript":
                text = _text_of(message)
                if text:
                    raw_seq = message.get("seq")
                    seq = int(raw_seq) if isinstance(raw_seq, (int, float)) else next_seq
                    await orchestrator.ingest_transcript(
                        text, seq=seq, is_final=bool(message.get("is_final", True)),
                    )
                    # A transcript with no call.start opens one; own that too.
                    mine = mine or orchestrator.call_id
                    next_seq = seq + 1
            elif kind == "call.end":
                if owns_the_call():
                    await orchestrator.end_call()
                return
    except WebSocketDisconnect:
        if owns_the_call():
            await orchestrator.end_call()


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
