/** Continuous walkthrough request for the fal Worker. */

import type { Approach, RoomGraph } from "./route";

export function walkPayload(
  origin: string,
  address: string,
  graph: RoomGraph,
  artifacts: { photos?: { id?: string; url?: string; room_id?: string | null }[] },
  approach: Approach | null,
  hazards: string[],
  fireRoom: string | null,
  routeRoomIds: string[],
) {
  const photoMap = graph.photo_room_map ?? {};
  const photoByRoom = new Map<string, string>();
  const unmatched: string[] = [];
  for (const photo of artifacts.photos ?? []) {
    if (!photo.url) continue;
    const absolute = photo.url.startsWith("http") ? photo.url : `${origin}${photo.url}`;
    const roomId = photo.room_id || photoMap[photo.id ?? ""];
    if (roomId && !photoByRoom.has(roomId)) photoByRoom.set(roomId, absolute);
    else if (!roomId) unmatched.push(absolute);
  }

  const rooms = new Map(graph.rooms.map((room) => [room.id, room]));
  const ordered: { room_id: string; name: string; floor: number }[] = [];
  const photos: Record<string, string> = {};

  const add = (roomId: string, name: string, floor: number, url?: string) => {
    if (ordered.some((item) => item.room_id === roomId)) return;
    ordered.push({ room_id: roomId, name, floor });
    if (url) photos[roomId] = url;
  };

  if (unmatched[0]) add("_street", "Front of the building", 0, unmatched[0]);

  for (const roomId of routeRoomIds) {
    if (!roomId || roomId === fireRoom) continue;
    const room = rooms.get(roomId);
    add(roomId, room?.name ?? roomId, room?.floor ?? 0, photoByRoom.get(roomId));
  }
  if (fireRoom) {
    const room = rooms.get(fireRoom);
    add(fireRoom, room?.name ?? fireRoom, room?.floor ?? 0, photoByRoom.get(fireRoom));
  }

  return {
    address,
    continuous: true,
    building_description: approach?.coverage
      ? `${(approach as { building_type?: string }).building_type ?? "house"}`
      : "",
    route: ordered,
    photos,
    hazards,
  };
}
