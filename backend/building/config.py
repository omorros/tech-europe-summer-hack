"""Env + paths for the building lane."""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BACKEND_DIR / "static"
CACHE_DIR = BACKEND_DIR / "cache"

load_dotenv(BACKEND_DIR / ".env")

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
HAI_API_KEY = os.getenv("HAI_API_KEY", "")  # Portal-H (H Company)
FAL_KEY = os.getenv("FAL_KEY", "")

OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-5")
HOLO_MODEL = os.getenv("HOLO_MODEL", "holo3-1-35b-a3b")
HOLO_BASE_URL = "https://api.hcompany.ai/v1/"

STATIC_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)
