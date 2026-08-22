"use client";

import { useState } from "react";

/**
 * The building's own Street View panorama, draggable.
 *
 * The approach lane's stills are what the vision model read and what the crew
 * card quotes, so they stay. This is the other half: a commander wants to look
 * left at the alley, up at the second-floor windows, behind at where the
 * appliance would stand. Stills cannot answer that; the pano can.
 *
 * Google's Embed API rather than the Maps JS SDK: one iframe, no loader, no
 * bundle, and it degrades to a plain message when the key is absent.
 */
export function StreetPano({
  lat,
  lng,
  heading,
}: {
  lat: number;
  lng: number;
  heading?: number;
}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
  const [failed, setFailed] = useState(false);

  if (!key || failed || !lat || !lng) {
    return (
      <p className="missing">
        <span className="stamp">No panorama</span>
        <span>
          {key
            ? "Street View has no coverage at this location."
            : "NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set, so the draggable view cannot load."}
        </span>
      </p>
    );
  }

  const src =
    `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}` +
    `&location=${lat},${lng}` +
    `&heading=${Math.round(heading ?? 0)}&pitch=0&fov=90`;

  return (
    <figure className="pano">
      <iframe
        src={src}
        title="Street View of the building, drag to look around"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        onError={() => setFailed(true)}
        allowFullScreen
      />
      <figcaption className="pano__hint">Drag to look around</figcaption>
    </figure>
  );
}
