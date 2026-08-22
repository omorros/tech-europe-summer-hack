"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAttachments } from "@/components/attachments";
import { StatusLine } from "@/components/StatusLine";
import { SyntheticStamp } from "@/components/plates";
import { sendRadio } from "@/lib/api";
import { sendConsole } from "@/lib/bus";
import { useIncidentContext } from "@/lib/incident-context";
import { useAutoFollow } from "@/lib/useAutoFollow";

export default function ConsolePage() {
  const router = useRouter();
  const { state, started, live, handedOver } = useIncidentContext();
  const attachments = useAttachments(state);
  const { openId, choose, fresh } = useAutoFollow(attachments, "record");
  const [radio, setRadio] = useState("");
  const [sending, setSending] = useState(false);

  const address = state.entities.find((entity) => entity.type === "ADDRESS")?.value;
  const briefing = state.briefing;

  // Stay on the console while the call is live so Approach / Plan / Rooms can
  // land, and so the walkthrough can render in the background. Hand over once
  // the caller hangs up and the crew card exists.
  useEffect(() => {
    if (!briefing || handedOver.current) return;
    if (state.callState !== "ended") return;
    handedOver.current = true;
    router.push("/video");
  }, [briefing, router, handedOver, state.callState]);

  // One hand drives this on stage: number keys reach every attachment.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") choose(null);
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && attachments[index]) choose(attachments[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachments, choose]);

  const open = attachments.find((item) => item.id === openId) ?? null;

  /** Fireground traffic goes up the open socket, or over HTTP if it is down. */
  async function pushRadio(event: React.FormEvent) {
    event.preventDefault();
    const text = radio.trim();
    if (!text || sending) return;
    setRadio("");
    if (sendConsole({ type: "radio.update", payload: { text } })) return;
    setSending(true);
    await sendRadio(text);
    setSending(false);
  }

  return (
    <main className="stage">
      <header className="stage__head">
        <h1 className="huge" style={{ margin: 0 }}>
          {address ?? (started ? "Listening" : "No incident")}
        </h1>
        {started ? (
          <StatusLine state={state} />
        ) : (
          <p className="status">Press R to replay the recorded call</p>
        )}
        {started && (
          <p className="status" style={{ margin: 0 }}>
            {live ? "Live bus" : "Local replay"}
          </p>
        )}
        {started && (
          <form className="radio" onSubmit={pushRadio}>
            <label className="sr-only" htmlFor="radio">
              Radio update from the fireground
            </label>
            <input
              id="radio"
              className="field"
              autoComplete="off"
              value={radio}
              placeholder="Radio update — flashover in the kitchen, rear exit blocked"
              onChange={(event) => setRadio(event.target.value)}
            />
            <button type="submit" className="control" disabled={!radio.trim() || sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </header>

      <nav className="tabs" aria-label="Attachments">
        {attachments.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="tab"
            aria-current={openId === item.id}
            data-ready={item.ready}
            onClick={() => choose(openId === item.id ? null : item.id)}
          >
            <span className="tab__key" aria-hidden="true">
              {index + 1}
            </span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {fresh.has(item.id) && <span className="tab__new">New</span>}
          </button>
        ))}

        {briefing && (
          <Link href="/video" className="tab tab--brief">
            Crew brief
          </Link>
        )}
      </nav>

      {open && (
        <section className="panel" aria-label={open.label}>
          <header className="stamp stamp-bar">
            <span style={{ flex: 1 }}>{open.label}</span>
            {!live && <SyntheticStamp />}
            <button type="button" className="panel__close" onClick={() => choose(null)}>
              Close
            </button>
          </header>
          <div className="panel__body paper-scroll">
            {open.ready ? (
              open.render()
            ) : (
              <p className="panel__waiting">
                <span className="stamp">Not reported</span>
                <span>{open.waitingOn}</span>
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
