"""Caller audio → text, using OpenAI's speech-to-text.

The handset records the call in short complete chunks and posts them here. The
key stays on this side: a browser holding an OpenAI key would ship it to every
client. Text goes straight into the orchestrator, so the console's record fills
from the same path a scripted call uses.
"""

from __future__ import annotations

import io
import os

MODEL = os.environ.get("LANTERN_STT_MODEL", "gpt-4o-mini-transcribe")
# whisper-1 is the older endpoint; it accepts the same file shapes and is the
# safety net if the account has no access to the newer model.
FALLBACK_MODEL = "whisper-1"

_EXTENSIONS = {
    "webm": "webm",
    "ogg": "ogg",
    "mp4": "mp4",
    "mpeg": "mp3",
    "wav": "wav",
}


def _extension(mime: str) -> str:
    """OpenAI infers the container from the filename, so it has to be right."""
    lowered = mime.lower()
    for needle, ext in _EXTENSIONS.items():
        if needle in lowered:
            return ext
    return "webm"


class TranscriptionUnavailable(RuntimeError):
    """No key, or the model refused. The handset says so rather than going quiet."""


async def transcribe(audio: bytes, *, mime: str = "audio/webm") -> str:
    if not os.environ.get("OPENAI_API_KEY"):
        raise TranscriptionUnavailable("OPENAI_API_KEY is not set")

    from openai import AsyncOpenAI

    client = AsyncOpenAI(timeout=30.0)
    filename = f"call.{_extension(mime)}"

    last: Exception | None = None
    for model in (MODEL, FALLBACK_MODEL):
        buffer = io.BytesIO(audio)
        buffer.name = filename
        try:
            result = await client.audio.transcriptions.create(
                model=model,
                file=buffer,
                language="en",
                # A 999 call is names, streets and postcodes; the prompt biases
                # the decoder towards hearing them as such.
                prompt="A UK 999 emergency call. House numbers, street names and postcodes.",
            )
            return (result.text or "").strip()
        except Exception as error:  # noqa: BLE001 — try the fallback, then report
            last = error

    raise TranscriptionUnavailable(str(last) if last else "transcription failed")
