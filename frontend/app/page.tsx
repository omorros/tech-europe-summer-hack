"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { connectBus } from "@/lib/bus";
import { DEMO_ADDRESS } from "@/lib/timeline";
import { SyntheticStamp } from "@/components/plates";

export default function AddressPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [heard, setHeard] = useState(false);

  // A mock call on /phone fills this field and opens the console, exactly the
  // way the ADDRESS entity will when the extractor is live.
  useEffect(
    () =>
      connectBus((event) => {
        if (event.type !== "call.incoming") return;
        setHeard(true);
        setAddress(DEMO_ADDRESS);
        window.setTimeout(() => router.push("/console"), 900);
      }),
    [router],
  );

  return (
    <main className="entry">
      <div className="stamp stamp-bar stamp-bar--steel">
        <span style={{ flex: 1 }}>SizeUp · Dispatch</span>
        <SyntheticStamp paper={false} />
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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!address.trim()) return;
                router.push("/console?run=1");
              }}
            >
              <label className="sr-only" htmlFor="address">
                Address of the emergency
              </label>
              <input
                id="address"
                className="field field--paper"
                autoFocus
                autoComplete="off"
                value={address}
                placeholder="House number, street, town, postcode"
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
                <button type="submit" className="control control--ink" disabled={!address.trim()}>
                  Open console
                </button>
                <span style={{ color: "var(--carbon)" }}>
                  {heard
                    ? "Address taken from the call. Opening the console."
                    : "Or take the call — open /phone on a handset."}
                </span>
              </div>
            </form>
          </div>
        </div>

        <p className="entry__note">
          Everything on the console is synthetic while the lanes are being wired:
          the call, the property and the imagery are placeholders against the
          real event shapes.
        </p>
      </div>
    </main>
  );
}
