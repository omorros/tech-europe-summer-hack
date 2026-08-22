"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAttachments } from "@/components/attachments";
import { SyntheticStamp } from "@/components/plates";
import { mediaUrl } from "@/lib/config";
import { useIncidentContext } from "@/lib/incident-context";
import { useAutoFollow } from "@/lib/useAutoFollow";
import type { WalkthroughLeg } from "@/lib/types";

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
    </div>
  );
}

export default function VideoPage() {
  const { state, live } = useIncidentContext();
  const attachments = useAttachments(state);
  const { openId, choose, fresh } = useAutoFollow(attachments);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hasBrief = Boolean(state.briefing);
  const videoSrc = mediaUrl(state.briefing?.video_url);
  const legs = state.briefing?.legs ?? [];
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

  return (
    <main className="film-stage">
      {/* Video only. A crew card rendered as text, or a line explaining that
          no render has happened, is not a walkthrough - and on the projected
          screen it reads as the product failing to do the thing it promises.
          Until there are frames, this screen stays dark and the record,
          approach, plan and rooms live in the corner where they always are. */}
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
      ) : null}

      {hasBrief && !live && (
        <span className="film-stage__mark">
          <SyntheticStamp paper={false} />
        </span>
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
