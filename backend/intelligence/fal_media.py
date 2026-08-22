"""fal media for the crew briefing: script -> speech -> talking avatar.

VEED Fabric 1.0 (`veed/fabric-1.0`) is audio-driven lip-sync: it takes a
still portrait plus an audio track and returns an MP4. It does NOT do
text-to-speech, so the chain is:

    script -> fal TTS (Kokoro) -> audio_url
           -> Fabric 1.0 (portrait + audio) -> video_url
           -> captions written locally from the script

Budget is the thing to watch. Fabric is priced per second of output:
$0.15/s at 720p, $0.08/s at 480p. A 30-second briefing is therefore $4.50
at 720p — nearly a fifth of the $25 `techeuropexfal-london` voucher, which
is shared with Oriol's reconstruction. So: 480p by default, every render
cached by script hash, and a hard spend ceiling that refuses rather than
silently draining the voucher.

Docs: fal.ai/models/veed/fabric-1.0, fal.ai/models/fal-ai/kokoro/american-english
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

FABRIC_MODEL = "veed/fabric-1.0"
TTS_MODEL = os.environ.get("SIZEUP_TTS_MODEL", "fal-ai/kokoro/american-english")

# Corner-bubble avatar: text in, talking video out, TTS included.
AVATAR_MODEL = "veed/avatars/text-to-video"
AVATAR_USD_PER_MINUTE = 0.35
AVATAR_ID = os.environ.get("SIZEUP_AVATAR_ID", "emily_primary")

# Fabric 1.0 output pricing, per second of video (fal.ai/models/veed/fabric-1.0).
FABRIC_USD_PER_SECOND = {"480p": 0.08, "720p": 0.15}

# "off"    = no talking head at all. THE DEFAULT, by team decision: a crew
#            riding to a job cannot hear narration over the sirens, so spoken
#            briefing is dead weight. The briefing survives as on-screen text.
# "avatar" = veed/avatars/text-to-video, one call, ~$0.18, no portrait.
# "fabric" = Kokoro TTS then Fabric lip-sync onto SIZEUP_AVATAR_URL, ~$2.40.
BUBBLE_MODE = os.environ.get("SIZEUP_BUBBLE_MODE", "off")

# 480p is the default deliberately: this plays in a console panel, and 720p
# costs nearly twice as much for a difference nobody watching the demo sees.
RESOLUTION = os.environ.get("SIZEUP_FAL_RESOLUTION", "480p")

# Half the $25 voucher, since it is shared with Oriol. Agree the real split at
# the 12:00 checkpoint and set SIZEUP_FAL_BUDGET_USD accordingly.
BUDGET_USD = float(os.environ.get("SIZEUP_FAL_BUDGET_USD", "12.50"))

# A calm, level dispatch-officer read. Kokoro voices are af_* female, am_* male.
VOICE = os.environ.get("SIZEUP_TTS_VOICE", "am_michael")

_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = _ROOT / "backend" / "static" / "briefing"
LEDGER_PATH = _ROOT / ".fal-spend.json"

_WORDS_PER_SECOND = 2.6


class FalBudgetExceeded(RuntimeError):
    """Refusing to spend past the agreed share of the voucher."""


def _fal():
    """Lazy so the keys-free skeleton runs without fal-client installed."""
    import fal_client
    return fal_client


def available() -> bool:
    if not os.environ.get("FAL_KEY"):
        return False
    try:
        _fal()
    except ImportError:
        return False
    return True


# --------------------------------------------------------------------------
# Spend ledger — the voucher is shared, so track every cent we take from it
# --------------------------------------------------------------------------

def _ledger() -> dict:
    if LEDGER_PATH.exists():
        return json.loads(LEDGER_PATH.read_text())
    return {"entries": [], "cache": {}}


def _write_ledger(data: dict) -> None:
    LEDGER_PATH.write_text(json.dumps(data, indent=2))


def spent_usd() -> float:
    return round(sum(e["usd"] for e in _ledger()["entries"]), 4)


def remaining_usd() -> float:
    return round(BUDGET_USD - spent_usd(), 4)


def _record(model: str, usd: float, note: str = "") -> None:
    data = _ledger()
    data["entries"].append({"ts": time.time(), "model": model,
                            "usd": round(usd, 4), "note": note})
    _write_ledger(data)


def _check_budget(usd: float, what: str) -> None:
    if usd > remaining_usd():
        raise FalBudgetExceeded(
            f"{what} would cost ${usd:.2f} but only ${remaining_usd():.2f} of the "
            f"${BUDGET_USD:.2f} share is left (spent ${spent_usd():.2f}). "
            f"Raise SIZEUP_FAL_BUDGET_USD only after checking with Oriol."
        )


def estimate_seconds(script: str) -> float:
    return max(1.0, len(script.split()) / _WORDS_PER_SECOND)


def estimate_render_usd(script: str, resolution: str = RESOLUTION) -> float:
    rate = FABRIC_USD_PER_SECOND.get(resolution, FABRIC_USD_PER_SECOND["720p"])
    return estimate_seconds(script) * rate


# --------------------------------------------------------------------------
# Cache — the same script must never be paid for twice
# --------------------------------------------------------------------------

def _cache_key(script: str, *, avatar_url: str, resolution: str, voice: str) -> str:
    blob = "|".join([script.strip(), avatar_url, resolution, voice, TTS_MODEL])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def cached(key: str) -> dict | None:
    return _ledger()["cache"].get(key)


def _cache(key: str, value: dict) -> None:
    data = _ledger()
    data["cache"][key] = value
    _write_ledger(data)


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

async def speak(script: str, *, voice: str = VOICE) -> tuple[str, float | None]:
    """Script -> audio URL. TTS is ~$0.02/1k characters, i.e. under a cent for
    a briefing, so it is not budget-relevant — but it is still logged."""
    result: Any = await _fal().subscribe_async(TTS_MODEL, arguments={
        "prompt": script, "voice": voice,
    })
    audio = result.get("audio") or {}
    url = audio.get("url") if isinstance(audio, dict) else audio
    if not url:
        raise RuntimeError(f"no audio url in TTS response: {str(result)[:300]}")
    _record(TTS_MODEL, len(script) / 1000 * 0.02, "briefing tts")
    duration = audio.get("duration") if isinstance(audio, dict) else None
    return url, float(duration) if isinstance(duration, (int, float)) else None


async def speak_as_avatar(script: str, *, avatar_id: str = AVATAR_ID) -> tuple[str, float]:
    """Script -> talking-avatar MP4, voice included. One call, no portrait.

    This is the corner bubble. VEED's avatars model has text-to-speech built
    in, so it replaces the Kokoro-then-Fabric chain entirely: the bubble
    carries the narration, and the walkthrough underneath stays silent.

    $0.35/minute against Fabric's $0.08/s — about 13x cheaper for a 30-second
    briefing, which is the right trade for something rendered 200px wide in a
    corner.
    """
    seconds = estimate_seconds(script)
    cost = seconds / 60 * AVATAR_USD_PER_MINUTE
    _check_budget(cost, f"avatar bubble ({seconds:.0f}s)")

    result: Any = await _fal().subscribe_async(AVATAR_MODEL, arguments={
        "avatar_id": avatar_id, "text": script,
    })
    video = result.get("video") or {}
    url = video.get("url") if isinstance(video, dict) else video
    if not url:
        raise RuntimeError(f"no video url in avatars response: {str(result)[:300]}")
    _record(AVATAR_MODEL, cost, f"bubble {seconds:.0f}s")
    return url, seconds


async def render(image_url: str, audio_url: str, *,
                 resolution: str = RESOLUTION, seconds: float) -> str:
    """Portrait + audio -> talking-head MP4 via VEED Fabric 1.0."""
    rate = FABRIC_USD_PER_SECOND.get(resolution, FABRIC_USD_PER_SECOND["720p"])
    cost = seconds * rate
    _check_budget(cost, f"Fabric render ({seconds:.0f}s at {resolution})")

    result: Any = await _fal().subscribe_async(FABRIC_MODEL, arguments={
        "image_url": image_url, "audio_url": audio_url, "resolution": resolution,
    })
    video = result.get("video") or {}
    url = video.get("url") if isinstance(video, dict) else video
    if not url:
        raise RuntimeError(f"no video url in Fabric response: {str(result)[:300]}")
    _record(FABRIC_MODEL, cost, f"briefing {seconds:.0f}s {resolution}")
    return url


def write_captions(script: str, duration_s: float, key: str) -> str:
    """WebVTT written locally — Fabric returns video only, and the console
    needs captions because a fireground is loud and the demo room is worse."""
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    sentences = [s.strip() for s in script.replace("\n", " ").split(". ") if s.strip()]
    total_words = sum(len(s.split()) for s in sentences) or 1

    lines = ["WEBVTT", ""]
    at = 0.0
    for sentence in sentences:
        span = duration_s * len(sentence.split()) / total_words
        lines += [f"{_stamp(at)} --> {_stamp(at + span)}",
                  sentence if sentence.endswith(".") else sentence + ".", ""]
        at += span

    path = STATIC_DIR / f"{key}.vtt"
    path.write_text("\n".join(lines))
    return f"/static/briefing/{path.name}"


def _stamp(seconds: float) -> str:
    minutes, secs = divmod(max(0.0, seconds), 60)
    return f"00:{int(minutes):02d}:{secs:06.3f}"


async def make_video(script: str, *, avatar_url: str | None = None,
                     resolution: str = RESOLUTION, voice: str = VOICE,
                     mode: str | None = None) -> dict:
    """The corner bubble: a person reporting the building over the walkthrough.

    Cached by script. Returns {video_url, captions_url, duration_s, cached,
    cost_usd}. The console overlays this on the walkthrough in CSS — nothing
    is composited server-side, so this is just one more video URL.

    Raises rather than falling back: briefing.py owns the decision to degrade
    to script-plus-captions, which is first in the PRD's cut order.
    """
    mode = mode or BUBBLE_MODE

    if mode == "off":
        raise RuntimeError(
            "SIZEUP_BUBBLE_MODE=off — no talking head (sirens drown narration). "
            "The briefing renders as text; the walkthrough carries the picture."
        )

    if mode == "avatar":
        key = _cache_key(script, avatar_url=AVATAR_ID, resolution="avatar", voice=AVATAR_ID)
        hit = cached(key)
        if hit:
            return {**hit, "cached": True}

        video_url, seconds = await speak_as_avatar(script)
        result = {
            "video_url": video_url,
            "captions_url": write_captions(script, seconds, key),
            "duration_s": round(seconds, 1),
            "audio_url": None,          # the bubble carries its own voice
            "cost_usd": round(seconds / 60 * AVATAR_USD_PER_MINUTE, 2),
        }
        _cache(key, result)
        return {**result, "cached": False}

    avatar_url = avatar_url or os.environ.get("SIZEUP_AVATAR_URL") or ""
    if not avatar_url:
        raise RuntimeError(
            "SIZEUP_BUBBLE_MODE=fabric needs SIZEUP_AVATAR_URL (a portrait to "
            "lip-sync). Use SIZEUP_BUBBLE_MODE=avatar to skip the portrait."
        )

    key = _cache_key(script, avatar_url=avatar_url, resolution=resolution, voice=voice)
    hit = cached(key)
    if hit:
        return {**hit, "cached": True}

    audio_url, duration = await speak(script, voice=voice)
    seconds = duration or estimate_seconds(script)
    video_url = await render(avatar_url, audio_url, resolution=resolution,
                             seconds=seconds)
    result = {
        "video_url": video_url,
        "captions_url": write_captions(script, seconds, key),
        "duration_s": round(seconds, 1),
        "audio_url": audio_url,
        "cost_usd": round(seconds * FABRIC_USD_PER_SECOND.get(
            resolution, FABRIC_USD_PER_SECOND["720p"]), 2),
    }
    _cache(key, result)
    return {**result, "cached": False}
