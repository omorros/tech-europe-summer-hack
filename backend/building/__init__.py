"""Oriol's lane: everything from an address to a navigable model of the house.

Locked entry points (PRD section 3):
    find_approach(address) -> Approach        emits approach.ready
    find_property(address) -> Artifacts       emits agent.step, agent.artifacts
    build_room_graph(artifacts) -> RoomGraph  emits rooms.graph
    reconstruct(room_id, photo) -> Scene      emits scene.ready
"""

from .agent import find_property
from .approach import find_approach
from .reconstruct import reconstruct
from .rooms import build_room_graph

__all__ = ["find_approach", "find_property", "build_room_graph", "reconstruct"]
