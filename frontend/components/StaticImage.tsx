"use client";

import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/config";

/**
 * A file the backend says it has, drawn from its /static mount.
 *
 * `backend/.gitignore` excludes static/approach/, so on a fresh clone the
 * cached approach.json can point at Street View frames that are not on disk.
 * That is a 404, and a 404 in an `<img>` is a browser's broken-image icon on a
 * projected console. Say the file is missing instead: a drawing in its place
 * would be a picture of a building nobody photographed.
 */
export function StaticImage({
  url,
  alt,
  missing,
}: {
  url: string | null | undefined;
  alt: string;
  /** What is absent, in the product's own words. */
  missing: string;
}) {
  const src = mediaUrl(url);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [src]);

  if (!src || broken) {
    return (
      <p className="missing">
        <span className="stamp">Not on disk</span>
        <span>{missing}</span>
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setBroken(true)}
      style={{ width: "100%", height: "auto", display: "block" }}
    />
  );
}
