"use client";

import { useId } from "react";
import type { Entity, Room, RoomGraph, Route, Scene } from "@/lib/types";

/** Floor-plan pixel coordinates, origin top-left. Same space as every pin. */
const VIEW = "10 60 980 420";

const centroid = (room: Room): [number, number] => {
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

const points = (room: Room) => room.polygon.map((p) => p.join(",")).join(" ");

function roomFor(entity: Entity | undefined, rooms: Room[]): Room | undefined {
  if (!entity) return undefined;
  const value = entity.value.toLowerCase();
  return rooms.find((room) => value.includes(room.name.toLowerCase()));
}

function polyline(pts: { x: number; y: number }[]) {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

function length(pts: { x: number; y: number }[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.round(total) || 1;
}

export function FloorPlan({
  graph,
  route,
  scene,
  entities,
}: {
  graph: RoomGraph;
  route: Route | null;
  scene: Scene | null;
  entities: Entity[];
}) {
  const hatchId = useId().replace(/:/g, "");
  const fire = roomFor(entities.find((e) => e.type === "FIRE_ORIGIN"), graph.rooms);
  const victim = roomFor(entities.find((e) => e.type === "VICTIM_LOCATION"), graph.rooms);
  const floorOf = (roomId: string) => graph.rooms.find((r) => r.id === roomId)?.floor ?? 0;

  // Split the route wherever it changes floor; the gap between legs is the stairs.
  const legs: { x: number; y: number }[][] = [];
  (route?.waypoints ?? []).forEach((waypoint, index, all) => {
    const previous = index > 0 ? all[index - 1] : null;
    const changedFloor =
      previous !== null && floorOf(previous.room_id) !== floorOf(waypoint.room_id);
    if (index === 0 || changedFloor) legs.push([waypoint]);
    else legs[legs.length - 1].push(waypoint);
  });

  const stairLink =
    legs.length === 2 && legs[0].length && legs[1].length
      ? { from: legs[0][legs[0].length - 1], to: legs[1][0] }
      : null;

  return (
    <svg
      viewBox={VIEW}
      role="img"
      aria-label="Floor plan with rooms labelled, hazards pinned and the planned route drawn"
      style={{ display: "block", width: "100%", height: "auto", background: "var(--paper)" }}
    >
      <defs>
        <pattern id={hatchId} width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--red)" strokeWidth="3" opacity="0.5" />
        </pattern>
      </defs>

      <text x="40" y="92" className="plan-label" fill="var(--carbon)">Ground floor</text>
      <text x="530" y="92" className="plan-label" fill="var(--carbon)">First floor</text>
      <line x1="500" y1="70" x2="500" y2="470" stroke="var(--paper-edge)" strokeWidth="2" strokeDasharray="6 6" />

      {graph.rooms.map((room) => {
        const [cx, cy] = centroid(room);
        const isFire = fire?.id === room.id;
        const isVictim = victim?.id === room.id;
        return (
          <g key={room.id}>
            <polygon
              points={points(room)}
              className={`plan-room${isFire ? " plan-room--fire" : ""}${isVictim ? " plan-room--victim" : ""}`}
            />
            {isFire && <polygon points={points(room)} fill={`url(#${hatchId})`} stroke="none" />}
            <text x={cx} y={cy - 4} textAnchor="middle" className="plan-label" fill="var(--carbon)">
              {room.name}
            </text>
            {room.doors.map(([x, y], index) => (
              <rect
                key={`d${index}`}
                x={x - 9}
                y={y - 3}
                width="18"
                height="6"
                fill="var(--paper)"
                stroke="var(--ink)"
                strokeWidth="2"
              />
            ))}
            {room.windows.map(([x, y], index) => (
              <line
                key={`w${index}`}
                x1={x - 14}
                y1={y}
                x2={x + 14}
                y2={y}
                stroke="var(--carbon)"
                strokeWidth="5"
              />
            ))}
          </g>
        );
      })}

      {legs.map((leg, index) =>
        leg.length > 1 ? (
          <polyline
            key={index}
            points={polyline(leg)}
            className="plan-route"
            style={{ "--len": length(leg) } as React.CSSProperties}
          />
        ) : null,
      )}

      {/* The route changes floor at the stairs. A line across the sheet would
          read as a corridor that does not exist, so each end is marked. */}
      {stairLink && (
        <g>
          <g className="plan-pin">
            <circle cx={stairLink.from.x} cy={stairLink.from.y} r="15" fill="var(--red)" />
            <text x={stairLink.from.x} y={stairLink.from.y + 6} textAnchor="middle" className="plan-label" fill="var(--paper)" fontSize="16">
              S
            </text>
          </g>
          <text x={stairLink.from.x + 24} y={stairLink.from.y + 6} className="plan-label" fill="var(--red)">
            Stairs up
          </text>
          <g className="plan-pin">
            <circle cx={stairLink.to.x} cy={stairLink.to.y} r="15" fill="var(--red)" />
            <text x={stairLink.to.x} y={stairLink.to.y + 6} textAnchor="middle" className="plan-label" fill="var(--paper)" fontSize="16">
              S
            </text>
          </g>
          <text x={stairLink.to.x - 24} y={stairLink.to.y + 6} textAnchor="end" className="plan-label" fill="var(--red)">
            From stairs
          </text>
        </g>
      )}

      {route && (
        <g className="plan-pin">
          <circle cx={route.waypoints[0].x} cy={route.waypoints[0].y} r="13" fill="var(--red)" />
          <text x={route.waypoints[0].x + 22} y={route.waypoints[0].y + 6} className="plan-label" fill="var(--red)">
            Entry
          </text>
        </g>
      )}

      {scene?.pins.map((pin, index) => (
        <g key={index} className="plan-pin">
          <rect x={pin.x - 12} y={pin.y - 12} width="24" height="24" fill="var(--red)" />
          <text x={pin.x} y={pin.y + 7} textAnchor="middle" className="plan-label" fill="var(--paper)" fontSize="15">
            {pin.entity_type === "VICTIM_LOCATION" ? "C" : "X"}
          </text>
        </g>
      ))}

      {fire && (
        <g className="plan-pin">
          <rect x={centroid(fire)[0] - 12} y={centroid(fire)[1] + 18} width="24" height="24" fill="var(--red)" />
          <text
            x={centroid(fire)[0]}
            y={centroid(fire)[1] + 37}
            textAnchor="middle"
            className="plan-label"
            fill="var(--paper)"
            fontSize="15"
          >
            F
          </text>
        </g>
      )}
    </svg>
  );
}
