"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "@/lib/useIncident";
import type { Entity } from "@/lib/types";

const ENTITY_LABEL: Record<Entity["type"], string> = {
  ADDRESS: "Address",
  FIRE_ORIGIN: "Fire",
  VICTIM_LOCATION: "Casualty",
  HAZARD_TYPE: "Hazard",
  EXIT: "Exit",
};

function EntityStamp({ entity }: { entity: Entity }) {
  return (
    <span
      className={`entity-stamp${entity.source === "radio" ? " entity-stamp--radio" : ""}`}
    >
      <span className="entity-stamp__type">{ENTITY_LABEL[entity.type]}</span>
      <span>{entity.value}</span>
    </span>
  );
}

function Line({ line }: { line: LogLine }) {
  const speaker =
    line.kind === "transcript"
      ? line.speaker === "caller"
        ? "Caller"
        : "Operator"
      : line.kind === "agent"
        ? `Agent ${line.step}`
        : line.kind === "radio"
          ? "Radio"
          : "System";

  return (
    <div
      className={`logline logline--${line.kind}${line.isFinal ? "" : " logline--partial"}`}
    >
      <div className="logline__body">
        <span
          className={`speaker speaker--${line.kind === "transcript" ? line.speaker : "system"}`}
        >
          {speaker}
          {line.kind === "agent" ? ` ${line.action}` : ""}
        </span>
        <span className="logline__text">{line.text}</span>
        {line.entities.length > 0 && (
          <div>
            {line.entities.map((entity, index) => (
              <EntityStamp key={`${entity.type}-${index}`} entity={entity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LogRoll({ lines }: { lines: LogLine[] }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <section className="roll" aria-label="Incident record">
      <div
        className="roll__lines paper-scroll"
        ref={scroller}
        tabIndex={0}
        aria-live="polite"
        aria-atomic="false"
      >
        {lines.length === 0 ? (
          <div className="logline">
            <div className="logline__body">
              <span className="logline__text" style={{ color: "var(--carbon)" }}>
                Line open. Nothing has been said yet.
              </span>
            </div>
          </div>
        ) : (
          lines.map((line) => <Line key={line.no} line={line} />)
        )}
      </div>
    </section>
  );
}
