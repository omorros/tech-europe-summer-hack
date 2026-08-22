"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAttachments } from "@/components/attachments";
import { ReconstructionFilm, SyntheticStamp } from "@/components/plates";
import { useIncidentContext } from "@/lib/incident-context";
import { useAutoFollow } from "@/lib/useAutoFollow";

/** Runs once through the brief and holds on the last line. A caption that
 *  loops forever implies a video with no end. */
function useCaption(script: string | undefined) {
  const sentences = useMemo(
    () => (script ? script.split(/(?<=\.)\s+/).filter(Boolean) : []),
    [script],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (sentences.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => {
        if (current >= sentences.length - 1) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 5200);
    return () => window.clearInterval(timer);
  }, [sentences.length]);

  return { text: sentences[index] ?? null, index, total: sentences.length };
}

export default function VideoPage() {
  const { state } = useIncidentContext();
  const attachments = useAttachments(state);
  const { openId, choose, fresh } = useAutoFollow(attachments);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const caption = useCaption(state.briefing?.script);
  const hasBrief = Boolean(state.briefing);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        setMenuOpen(false);
        choose(null);
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && attachments[index]) choose(attachments[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachments, choose]);

  const open = attachments.find((item) => item.id === openId) ?? null;

  return (
    <main className="film-stage">
      {hasBrief ? (
        <>
          <div className="film-stage__media">
            <ReconstructionFilm />
          </div>
          <span className="film-stage__mark">
            <SyntheticStamp paper={false} />
          </span>
        </>
      ) : (
        <div className="film-stage__empty">
          <p className="huge" style={{ margin: 0 }}>
            No brief on this console
          </p>
          <p className="status">
            Take a call, or press R on the console to replay the recorded one.
          </p>
        </div>
      )}

      {hasBrief && caption.text && !open && (
        <p className="caption caption--film">{caption.text}</p>
      )}

      {/* One control in the corner. It opens a list; the list opens a window.
          The video is never displaced by a row of buttons. */}
      <div className="pop" data-open={Boolean(open)} data-expanded={expanded}>
        {open && (
          <div className="pop__window">
            <header className="stamp stamp-bar">
              <span style={{ flex: 1 }}>{open.label}</span>
              <SyntheticStamp />
              <button
                type="button"
                className="panel__close"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Shrink" : "Expand"}
              </button>
              <button type="button" className="panel__close" onClick={() => choose(null)}>
                Close
              </button>
            </header>
            <div className="pop__body paper-scroll">
              {open.ready ? (
                open.render()
              ) : (
                <p className="panel__waiting">
                  <span className="stamp">Not reported</span>
                  <span>{open.waitingOn}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {menuOpen && (
          <ul className="pop__menu" aria-label="Attachments">
            {attachments.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="pop__item"
                  aria-current={openId === item.id}
                  data-ready={item.ready}
                  onClick={() => {
                    choose(openId === item.id ? null : item.id);
                    setMenuOpen(false);
                  }}
                >
                  <span className="tab__key" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {fresh.has(item.id) && <span className="tab__new">New</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className={`control pop__toggle${menuOpen ? " control--solid" : ""}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {open ? open.label : "Attachments"}
          {fresh.size > 0 && !menuOpen && <span className="tab__new">New</span>}
        </button>
      </div>

      <Link href="/console" className="control film-stage__back">
        Console
      </Link>
    </main>
  );
}
