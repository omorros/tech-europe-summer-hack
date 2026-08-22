"""fal Hunyuan World reconstruction of critical rooms.

STUB: returns the cached scene for the room. Real fal call lands in the
15:15-16:15 window; demo scenes for the golden property are pre-generated and
cached, live calls swap in when budget allows (~$0.30/request, $25 voucher
shared with Bill's briefing video).
"""

from shared import bus
from shared.types import Photo, Scene

from .golden import load_cached

_current_address = ""  # set by the wiring before reconstruct calls


def set_address(address: str) -> None:
    global _current_address
    _current_address = address


async def reconstruct(room_id: str, photo: Photo) -> Scene:
    scene: Scene = load_cached(_current_address, f"scene_{room_id}") or {
        "room_id": room_id,
        "viewer_url": "",
        "thumbnail_url": "",
        "pins": [],
    }
    bus.emit("scene.ready", scene)
    return scene
