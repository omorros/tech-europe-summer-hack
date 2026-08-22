"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAttachments } from "@/components/attachments";
import { StatusLine } from "@/components/StatusLine";
import { SyntheticStamp } from "@/components/plates";
import { useIncidentContext } from "@/lib/incident-context";
import { useAutoFollow } from "@/lib/useAutoFollow";

export default function ConsolePage() {
  const router = useRouter();
  const { state, started, handedOver } = useIncidentContext();
  const attachments = useAttachments(state);
  const { openId, choose, fresh } = useAutoFollow(attachments, "record");

  const address = state.entities.find((entity) => entity.type === "ADDRESS")?.value;
  const briefing = state.briefing;

  // When the call is done and the brief lands, the video takes over — once per
  // run. Coming back here deliberately must not bounce straight out again.
  useEffect(() => {
    if (!briefing || handedOver.current) return;
    handedOver.current = true;
    router.push("/video");
  }, [briefing, router, handedOver]);

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
            <SyntheticStamp />
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
