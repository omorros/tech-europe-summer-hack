/**
 * The one honesty marker left. The drawn stand-ins that used to live here —
 * elevation, plot, room photo, walkthrough — are gone: the lanes deliver real
 * imagery now, and a drawing in place of a missing file is a picture of a
 * building nobody photographed. Absent files say they are absent instead.
 */

export function SyntheticStamp({ paper = true }: { paper?: boolean }) {
  return (
    <span className={paper ? "synthetic synthetic--paper" : "synthetic"}>
      Synthetic
    </span>
  );
}

