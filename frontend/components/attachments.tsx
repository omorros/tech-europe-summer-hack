"use client";

import { useMemo, type ReactNode } from "react";
import { LogRoll } from "./LogRoll";
import { Fact } from "./Sheet";
import { FloorPlan } from "./FloorPlan";
import { RoomsGallery } from "./RoomsGallery";
import { StaticImage } from "./StaticImage";
import type { IncidentState } from "@/lib/useIncident";

export interface Attachment {
  id: string;
  label: string;
  ready: boolean;
  /** Why it is not here yet. Shown instead of the content, never a spinner. */
  waitingOn: string;
  render: () => ReactNode;
}

/** Every drawn mark on the plan is named. */
function PlanLegend() {
  return (
    <ul className="legend">
      <li>
        <b data-shape="round">S</b> Stairs
      </li>
      <li>
        <b>F</b> Fire origin
      </li>
      <li>
        <b>C</b> Casualty
      </li>
      <li>
        <b>X</b> Blocked exit
      </li>
      <li>
        <b data-shape="round" aria-hidden="true" /> Entry point
      </li>
    </ul>
  );
}

/** One definition, read by both /console and /video. */
export function useAttachments(state: IncidentState): Attachment[] {
  const { approach, artifacts, graph, route, scene, entities } = state;

  // The whole conversation, minus the machine's own chatter. A real caller
  // says plenty that carries no entity ("hello", "please hurry", "I can hear
  // her"), and a record that hides it is not a record of the call.
  const extracted = useMemo(
    () => state.lines.filter((line) => line.kind === "transcript" || line.kind === "radio"),
    [state.lines],
  );

  return useMemo(
    () => [
      {
        id: "record",
        label: "Record",
        ready: extracted.length > 0,
        waitingOn: "Nothing has been extracted from the call yet.",
        render: () => <LogRoll lines={extracted} />,
      },
      {
        id: "approach",
        label: "Approach",
        ready: Boolean(approach),
        waitingOn: "Google Maps fires the moment the address is spoken.",
        render: () =>
          approach && (
            <>
              <div className="approach-plates">
                {approach.coverage ? (
                  <StaticImage
                    url={approach.streetview[0]?.url}
                    alt={`Street View, heading ${approach.streetview[0]?.heading ?? 0}`}
                    missing="The Street View frame is not on this machine. Re-run the approach lane to fetch it."
                  />
                ) : (
                  <p style={{ margin: 0, color: "var(--red)" }}>
                    No Street View coverage at this address. Working from the plot only.
                  </p>
                )}
                <StaticImage
                  url={approach.satellite_url}
                  alt="Satellite plot"
                  missing="The satellite tile is not on this machine."
                />
              </div>
              <hr className="rule" />
              <Fact label="Building">{approach.building_type}</Fact>
              <Fact label="Front door">
                {approach.front_door.side}. {approach.front_door.description}
              </Fact>
              <Fact label="Stand">{approach.parking}</Fact>
              <Fact label="Rear">
                {approach.rear_access ? approach.rear_access_note : "No rear access"}
              </Fact>
              {approach.obstacles.map((note) => (
                <p key={note} className="tick" style={{ margin: 0, color: "var(--red)" }}>
                  <span aria-hidden="true">!</span>
                  <span>{note}</span>
                </p>
              ))}
            </>
          ),
      },
      {
        id: "plan",
        label: "Plan",
        ready: Boolean(graph),
        waitingOn: "The agent is still inside the listing.",
        render: () =>
          graph && (
            <>
              <FloorPlan graph={graph} route={route} scene={scene} entities={entities} />
              <div className="plan-notes">
                <PlanLegend />
                {route && <p style={{ margin: "0.5rem 0 0" }}>{route.rationale}</p>}
              </div>
            </>
          ),
      },
      {
        id: "rooms",
        label: "Rooms",
        ready: Boolean(artifacts),
        waitingOn: "The agent has not opened the gallery yet.",
        render: () => <RoomsGallery photos={artifacts?.photos ?? []} />,
      },
    ],
    [extracted, approach, graph, route, scene, artifacts, entities],
  );
}
