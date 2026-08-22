"use client";

import { useId, useMemo, useState } from "react";
import { mediaUrl } from "@/lib/config";
import type { Entity, Room, RoomGraph, Route, Scene } from "@/lib/types";

/** Fallback only for the fabricated demo plan in timeline.ts. Real graphs
 *  publish floorplan_width / floorplan_height — never guess past that. */
const DEMO_VIEW = "10 60 980 420";

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
  floorplanUrl,
}: {
  graph: RoomGraph;
  route: Route | null;
  scene: Scene | null;
  entities: Entity[];
  /** The listing's own floor plan. Room polygons are in its pixel space, so
   *  the drawing and the overlay line up without any transform. */
  floorplanUrl?: string | null;
}) {
  const [planBroken, setPlanBroken] = useState(false);
  const hatchId = useId().replace(/:/g, "");
  const fire = roomFor(entities.find((e) => e.type === "FIRE_ORIGIN"), graph.rooms);
  const victim = roomFor(entities.find((e) => e.type === "VICTIM_LOCATION"), graph.rooms);
  const firePin = fire ? centroid(fire) : null;
  const measured = Boolean(graph.floorplan_width && graph.floorplan_height);
  const planSrc = mediaUrl(floorplanUrl);
  // The real plan only lines up if the graph was measured against it.
  const showPlan = Boolean(planSrc) && measured && !planBroken;
  const viewBox = measured
    ? `0 0 ${graph.floorplan_width} ${graph.floorplan_height}`
    : DEMO_VIEW;

  const floors = useMemo(
    () => new Map(graph.rooms.map((room) => [room.id, room.floor])),
    [graph.rooms],
  );

  const floorOf = (roomId: string | null): number | "kerb" =>
    roomId == null ? "kerb" : floors.get(roomId) ?? 0;

  // Kerb is outside: keep it on the first indoor leg (plan-edge → entry door)
  // instead of treating null as floor 0.
  const legs: { x: number; y: number }[][] = [];
  (route?.waypoints ?? []).forEach((waypoint, index, all) => {
    const previous = index > 0 ? all[index - 1] : null;
    const here = floorOf(waypoint.room_id);
    const prevFloor = previous ? floorOf(previous.room_id) : null;
    const changedFloor =
      previous !== null &&
      here !== "kerb" &&
      prevFloor !== "kerb" &&
      prevFloor !== here;
    if (index === 0 || changedFloor) legs.push([waypoint]);
    else legs[legs.length - 1].push(waypoint);
  });

  const stairLink =
    legs.length === 2 && legs[0].length && legs[1].length
      ? { from: legs[0][legs[0].length - 1], to: legs[1][0] }
      : null;

  const kerb = route?.waypoints.find((waypoint) => waypoint.room_id == null) ?? null;
  const entry =
    route?.waypoints.find((waypoint) => waypoint.room_id === route.entry_point) ??
    route?.waypoints.find((waypoint) => waypoint.room_id != null) ??
    null;

  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label="Floor plan with the fire, the casualty and the planned route marked"
      className="plan-svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id={hatchId} width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--red)" strokeWidth="3" opacity="0.5" />
        </pattern>
      </defs>

      {!measured && (
        <>
          <text x="40" y="92" className="plan-label" fill="var(--carbon)">Ground floor</text>
          <text x="530" y="92" className="plan-label" fill="var(--carbon)">First floor</text>
          <line x1="500" y1="70" x2="500" y2="470" stroke="var(--paper-edge)" strokeWidth="2" strokeDasharray="6 6" />
        </>
      )}

      {/* The listing's own floor plan, underneath everything. It already draws
          the walls, doors, windows and room names far better than we can from
          polygons, so with it present we contribute only the incident: the
          rooms that matter, the pins and the route. */}
      {showPlan && (
        <image
          href={planSrc}
          x="0"
          y="0"
          width={graph.floorplan_width}
          height={graph.floorplan_height}
          preserveAspectRatio="none"
          onError={() => setPlanBroken(true)}
        />
      )}

      {graph.rooms.map((room) => {
        const [cx, cy] = centroid(room);
        const isFire = fire?.id === room.id;
        const isVictim = victim?.id === room.id;
        // Over the real plan, an untouched room needs no mark at all.
        if (showPlan && !isFire && !isVictim) return null;
        return (
          <g key={room.id}>
            <polygon
              points={points(room)}
              className={`plan-room${isFire ? " plan-room--fire" : ""}${isVictim ? " plan-room--victim" : ""}`}
              style={showPlan ? { stroke: "none" } : undefined}
            />
            {isFire && <polygon points={points(room)} fill={`url(#${hatchId})`} stroke="none" />}
            {!showPlan && (
              <text x={cx} y={cy - 4} textAnchor="middle" className="plan-label" fill="var(--carbon)">
                {room.name}
              </text>
            )}
            {!showPlan && room.doors.map(([x, y], index) => (
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
            {!showPlan && room.windows.map(([x, y], index) => (
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

      {kerb && (
        <g className="plan-pin">
          <circle cx={kerb.x} cy={kerb.y} r="13" fill="none" stroke="var(--red)" strokeWidth="3" />
          <text x={kerb.x + 22} y={kerb.y + 6} className="plan-label" fill="var(--red)">
            Kerb
          </text>
        </g>
      )}

      {entry && (
        <g className="plan-pin">
          <circle cx={entry.x} cy={entry.y} r="13" fill="var(--red)" />
          <text x={entry.x + 22} y={entry.y + 6} className="plan-label" fill="var(--red)">
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

      {firePin && (
        <g className="plan-pin">
          <rect x={firePin[0] - 12} y={firePin[1] + 18} width="24" height="24" fill="var(--red)" />
          <text
            x={firePin[0]}
            y={firePin[1] + 37}
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
