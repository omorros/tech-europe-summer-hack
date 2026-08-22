"""Env + paths for the intelligence lane.

Mirrors `building/config.py` deliberately: same `backend/.env`, same
BACKEND_DIR-relative paths. We do not import that module — the PRD says no
lane imports another lane's internals, and importing `building` would drag in
playwright, PIL and openai for what is two constants.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
STATIC_DIR = BACKEND_DIR / "static"
CACHE_DIR = BACKEND_DIR / "cache"

load_dotenv(BACKEND_DIR / ".env")


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


# Pioneer / GLiNER2
PIONEER_API_KEY = env("PIONEER_API_KEY")
PIONEER_MODEL_ID = env("PIONEER_MODEL_ID")
PIONEER_BRIEFING_MODEL = env("PIONEER_BRIEFING_MODEL", "google/gemma-4-31B-it")

# Walkthrough Worker (holds its own FAL_KEY; we only need the address)
WORKER_URL = env("SIZEUP_WORKER_URL").rstrip("/")
WORKER_TOKEN = env("SIZEUP_WORKER_TOKEN")

FAL_KEY = env("FAL_KEY")


def resolve_static(url: str) -> Path | None:
    """`/static/artifacts/…/photo-01.jpg` -> the file on disk.

    The building lane emits server-relative URLs because the console fetches
    them from our own FastAPI mount. Anything leaving this machine — fal, in
    particular — cannot resolve those, so we need the real path.
    """
    if not url or "://" in url or url.startswith("data:"):
        return None
    path = STATIC_DIR / url.removeprefix("/static/").lstrip("/")
    return path if path.is_file() else None
