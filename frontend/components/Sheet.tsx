import type { ReactNode } from "react";

/** A labelled row of record. The only key/value device in the system. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact__key">{label}</span>
      <span className="fact__value">{children}</span>
    </div>
  );
}
