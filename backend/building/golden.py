"""Cached golden-property fallbacks.

Every stage of the building lane degrades to these instead of hanging (PRD
section 5). Cache layout: backend/cache/<slug>/{approach,artifacts,rooms,scene_<room_id>}.json
where slug is the address slugified. Files are committed to the repo so the
demo fallback travels with a clone.
"""

import json
import re
from typing import Any

from .config import CACHE_DIR


def slugify(address: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", address.lower()).strip("-")[:80]


def load_cached(address: str, kind: str) -> Any | None:
    path = CACHE_DIR / slugify(address) / f"{kind}.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def save_cached(address: str, kind: str, data: Any) -> None:
    d = CACHE_DIR / slugify(address)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{kind}.json").write_text(json.dumps(data, indent=2, default=str))
