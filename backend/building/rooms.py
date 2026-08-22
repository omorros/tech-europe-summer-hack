"""Floor plan -> room graph, photo-room matching.

STUB: returns cached golden-property room graph. Real OpenAI vision read of the
floor plan lands in the 14:30-15:15 window. Coordinate space is floor-plan
pixel coordinates, origin top-left; the emission publishes the image size.
"""

from shared import bus
from shared.types import Artifacts, RoomGraph

from .golden import load_cached


async def build_room_graph(artifacts: Artifacts) -> RoomGraph:
    graph: RoomGraph = load_cached(artifacts["address"], "rooms") or {
        "rooms": [],
        "adjacency": [],
        "entry_points": [],
        "photo_room_map": {},
        "floorplan_width": 0,
        "floorplan_height": 0,
    }
    bus.emit("rooms.graph", graph)
    return graph
