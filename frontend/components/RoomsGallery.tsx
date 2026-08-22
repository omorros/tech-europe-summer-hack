"use client";

import { useEffect, useState } from "react";
import { PhotoPlate } from "./plates";
import type { Photo } from "@/lib/types";

/** Thumbnails until you pick one; then that room fills the sheet. */
export function RoomsGallery({ photos }: { photos: Photo[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = photos.find((photo) => photo.id === openId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (open) {
    return (
      <figure className="room-open">
        <button type="button" className="room-open__back" onClick={() => setOpenId(null)}>
          ← All rooms
        </button>
        <PhotoPlate caption={open.caption} />
        <figcaption className="room-open__caption">{open.caption}</figcaption>
      </figure>
    );
  }

  return (
    <div className="rooms">
      {photos.map((photo) => (
        <button
          key={photo.id}
          type="button"
          className="room"
          onClick={() => setOpenId(photo.id)}
        >
          <PhotoPlate caption={photo.caption} />
          <span className="room__caption">{photo.caption}</span>
        </button>
      ))}
    </div>
  );
}
