"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startIncident } from "@/lib/api";
import { connectBus } from "@/lib/bus";
import { consumeBackendParam } from "@/lib/config";

export default function AddressPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef<number | null>(null);

  useEffect(() => {
    consumeBackendParam();
    const stop = connectBus((event) => {
      if (event.type !== "call.incoming") return;
      setHeard(true);
      leaving.current = window.setTimeout(() => router.push("/console"), 900);
    });
    return () => {
      stop();
      if (leaving.current !== null) window.clearTimeout(leaving.current);
    };
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = address.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const remote = await startIncident({ address: value });
    if (remote) {
      router.push("/console");
      return;
    }
    // Say what happened before the screen changes, or the operator watches a
    // recorded call at a different address with no idea why.
    setBusy(false);
    setError("Backend not reachable — opening the recorded run instead.");
    leaving.current = window.setTimeout(() => router.push("/console?run=1"), 1400);
  }

  return (
    <main className="entry">
      <div className="stamp stamp-bar stamp-bar--steel">
        <span style={{ flex: 1 }}>Lantern · Dispatch</span>
      </div>

      <div className="entry__body">
        <div className="entry__sheet">
          <header className="stamp stamp-bar">
            <span style={{ flex: 1 }}>New incident</span>
            <span>{heard ? "from call" : "manual"}</span>
          </header>
          <div style={{ padding: "1.3rem 1.3rem 1.5rem" }}>
            <h1 className="huge" style={{ margin: "0 0 1rem", color: "var(--ink)" }}>
              Address of the
              <br />
              emergency
            </h1>
            <form onSubmit={submit}>
              <label className="sr-only" htmlFor="address">
                Address of the emergency
              </label>
              <input
                id="address"
                className="field field--paper"
                autoFocus
                autoComplete="off"
                value={address}
                placeholder="14 Deerdale Road, London SE24 0AW"
                onChange={(event) => setAddress(event.target.value)}
              />
              <div
                style={{
                  display: "flex",
                  gap: "0.8rem",
                  alignItems: "center",
                  marginTop: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <button type="submit" className="control control--ink" disabled={!address.trim() || busy}>
                  {busy ? "Opening…" : "Open console"}
                </button>
                <span style={{ color: "var(--carbon)" }}>
                  Any UK address. The street is read in seconds; a listing, if
                  this property ever had one, follows.
                </span>
              </div>
              {error && (
                <p style={{ color: "var(--red)", margin: "0.8rem 0 0" }}>{error}</p>
              )}
            </form>
          </div>
        </div>

        <p className="entry__note">
          Typed address hits the FastAPI bus. Cached golden properties assemble
          from disk; anything else runs the live lanes. Press R on the console
          to replay if the backend is down.
        </p>
      </div>
    </main>
  );
}
