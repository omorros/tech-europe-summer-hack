"use client";

import { useEffect, useState, type ReactNode } from "react";
import { mediaUrl } from "@/lib/config";

/**
 * A file the backend says it has, drawn from its /static mount.
 *
 * `backend/.gitignore` excludes static/approach/, so on a fresh clone the
 * cached approach.json points at Street View frames that are not on disk.
 * That is a 404, and a 404 in an <img> is a browser's broken-image icon on a
 * projected console. Fall back to the drawn plate instead: it says the same
 * thing honestly.
 */
export function StaticImage({
  url,
  alt,
  fallback,
}: {
  url: string | null | undefined;
  alt: string;
  fallback: ReactNode;
}) {
  const src = mediaUrl(url);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [src]);

  if (!src || broken) return <>{fallback}</>;
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
