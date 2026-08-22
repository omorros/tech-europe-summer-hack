"""Locked shared types from the PRD (section 3, identical in all three lane PRDs).

TEMPORARY copy owned by Oriol's branch so the building lane can build before
Mykyta's shared files land. On merge, Mykyta's version of this file wins;
shapes here must never drift from the PRD table.
"""

from typing import TypedDict

ENTITY_TYPES = ("ADDRESS", "FIRE_ORIGIN", "VICTIM_LOCATION", "HAZARD_TYPE", "EXIT")


class Entity(TypedDict):
    type: str  # one of ENTITY_TYPES
    value: str
    confidence: float
    source: str  # "call" | "radio"
    ts: float


class Photo(TypedDict):
    id: str
    url: str
    caption: str
    room_id: str | None


class Artifacts(TypedDict):
    address: str
    listing_url: str
    floorplan_url: str
    photos: list[Photo]


class StreetView(TypedDict):
    heading: float
    url: str


class FrontDoor(TypedDict):
    side: str
    description: str


class Approach(TypedDict):
    lat: float
    lng: float
    streetview: list[StreetView]
    satellite_url: str
    building_type: str
    storeys: int
    front_door: FrontDoor
    access_notes: list[str]
    obstacles: list[str]
    rear_access: bool
    rear_access_note: str
    parking: str
    coverage: bool


class Room(TypedDict):
    id: str
    name: str
    floor: int
    polygon: list[list[float]]  # floor-plan pixel coords, origin top-left
    doors: list[list[float]]
    windows: list[list[float]]


class RoomGraph(TypedDict):
    rooms: list[Room]
    adjacency: list[list[str]]  # [room_id, room_id] pairs
    entry_points: list[str]
    photo_room_map: dict[str, str]  # photo_id -> room_id
    floorplan_width: int  # published so nobody guesses the coordinate space
    floorplan_height: int


class Pin(TypedDict):
    entity_type: str
    x: float
    y: float


class Scene(TypedDict):
    room_id: str
    viewer_url: str
    thumbnail_url: str
    pins: list[Pin]


class Waypoint(TypedDict):
    room_id: str
    x: float
    y: float


class Route(TypedDict):
    waypoints: list[Waypoint]
    entry_point: str
    rationale: str


class Briefing(TypedDict):
    video_url: str
    captions_url: str
    duration_s: float
    script: str
