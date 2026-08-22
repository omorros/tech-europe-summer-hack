"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAttachments } from "@/components/attachments";
import { SyntheticStamp } from "@/components/plates";
import { Fact } from "@/components/Sheet";
import { mediaUrl } from "@/lib/config";
import { useIncidentContext } from "@/lib/incident-context";
import { useAutoFollow } from "@/lib/useAutoFollow";
import type { WalkthroughLeg } from "@/lib/types";

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
  }, [sentences]);

  return { text: sentences[index] ?? null, index, total: sentences.length };
}

function WalkPlaylist({
  legs,
  onExhausted,
}: {
  legs: WalkthroughLeg[];
  onExhausted: () => void;
}) {
  const playable = useMemo(() => legs.filter((leg) => leg.video_url), [legs]);
  const [index, setIndex] = useState(0);
  const current = playable[index];

  useEffect(() => {
    setIndex(0);
  }, [playable]);

  // A clip the backend cannot serve must not park the walk on a dead frame:
  // step over it, and tell the page when there is nothing left to play.
  useEffect(() => {
    if (playable.length > 0 && !current) onExhausted();
  }, [current, playable.length, onExhausted]);

  if (!current) return null;
  const src = mediaUrl(current.video_url);
  const partial = legs.some((leg) => leg.status === "PARTIAL" || leg.status === "FAILED");

  return (
    <div className="film-stage__media">
      <video
        key={src}
        src={src}
        autoPlay
        muted
        playsInline
        onEnded={() => setIndex((value) => Math.min(value + 1, playable.length - 1))}
        onError={() => setIndex((value) => value + 1)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {current.narration && (
        <p className="caption caption--film">{current.narration}</p>
      )}
      <p className="status" style={{ position: "absolute", left: "1.2rem", bottom: "1.2rem" }}>
        Leg {index + 1} of {playable.length}
        {current.label ? ` — ${current.label}` : ""}
        {partial ? " · partial (some legs failed)" : ""}
      </p>
    </div>
  );
}

export default function VideoPage() {
  const { state, live } = useIncidentContext();
  const attachments = useAttachments(state);
  const { openId, choose, fresh } = useAutoFollow(attachments);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const caption = useCaption(state.briefing?.script);
  const hasBrief = Boolean(state.briefing);
  const videoSrc = mediaUrl(state.briefing?.video_url);
  const lines = state.briefing?.lines ?? [];
  const legs = state.briefing?.legs ?? [];
  const coverage = state.briefing?.coverage;
  const playable = useMemo(() => legs.filter((leg) => leg.video_url), [legs]);

  // Media the backend advertised but cannot serve. Reset whenever a new brief
  // arrives, so a re-brief gets a fresh attempt at its clips.
  const [walkFailed, setWalkFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    setWalkFailed(false);
    setVideoFailed(false);
  }, [state.briefing]);
  const onExhausted = useCallback(() => setWalkFailed(true), []);

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
  const showWalk = playable.length > 0 && !walkFailed;
  const showVideo = !showWalk && Boolean(videoSrc) && !videoFailed;
  const showLines = !showWalk && !showVideo && lines.length > 0;

  return (
    <main className="film-stage">
      {hasBrief ? (
        <>
          {showWalk ? (
            <WalkPlaylist legs={legs} onExhausted={onExhausted} />
          ) : showVideo ? (
            <div className="film-stage__media">
              <video
                src={videoSrc}
                autoPlay
                muted
                playsInline
                onError={() => setVideoFailed(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ) : showLines ? (
            <div className="film-stage__media">
              <div style={{ padding: "3rem 4rem", maxWidth: "52rem" }}>
                {coverage && (
                  <p className="status" style={{ margin: "0 0 1.2rem" }}>
                    Walkthrough covers {coverage.with_imagery} of {coverage.route_rooms} rooms
                    on the route
                    {coverage.missing.length > 0
                      ? ` — not photographed: ${coverage.missing.join(", ")}`
                      : ""}
                    . Hallways are often missing; a short walk is not a complete tour.
                  </p>
                )}
                {lines.map((line) => (
                  <Fact key={line.label} label={line.label} source={line.source}>
                    {line.value}
                  </Fact>
                ))}
              </div>
            </div>
          ) : (
            // A crew card with no walkthrough behind it. Drawing a room nobody
            // photographed would be inventing the one thing this product must
            // never invent.
            <div className="film-stage__empty">
              <p className="huge" style={{ margin: 0 }}>
                No walkthrough rendered
              </p>
              <p className="status">
                The crew card is ready — open it from the corner. The walk needs
                a fal render, which has not run for this address.
              </p>
            </div>
          )}
          {!live && (
            <span className="film-stage__mark">
              <SyntheticStamp paper={false} />
            </span>
          )}
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

      {hasBrief && caption.text && !open && !showWalk && (
        <p className="caption caption--film">{caption.text}</p>
      )}

      <div className="pop" data-open={Boolean(open)} data-expanded={expanded}>
        {open && (
          <div className="pop__window">
            <header className="stamp stamp-bar">
              <span style={{ flex: 1 }}>{open.label}</span>
              {!live && <SyntheticStamp />}
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
