import type { ReactNode } from "react";

/** A labelled row of record. The only key/value device in the system. */
export function Fact({
  label,
  children,
  source,
}: {
  label: string;
  children: ReactNode;
  source?: "call" | "street" | "listing" | "plan";
}) {
  const weak = source === "listing" || source === "plan";
  return (
    <div className={`fact${source ? " fact--sourced" : ""}`} data-source={source}>
      <span className="fact__key">{label}</span>
      <span className="fact__value" style={weak ? { color: "var(--carbon)" } : undefined}>
        {children}
      </span>
      {source && <span className="fact__source">{source}</span>}
    </div>
  );
}
