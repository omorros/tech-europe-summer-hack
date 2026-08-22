/**
 * Authored placeholder plates. Every real image in this product arrives from a
 * lane that is not built yet (Street View, satellite, agent screenshots,
 * listing photos, the rendered brief). Rather than grey boxes or stock chrome,
 * each blank is drawn in the record's own grammar — drafting lines on paper,
 * stamped SYNTHETIC — so the composition is real while the pixels are not.
 *
 * REPLACE LIST for the day: swap each of these for the lane's `url` field.
 */

export function SyntheticStamp({ paper = true }: { paper?: boolean }) {
  return (
    <span className={paper ? "synthetic synthetic--paper" : "synthetic"}>
      Synthetic
    </span>
  );
}

/** Front elevation, drawn from the listing description. Stands in for Street View. */
export function ElevationPlate({ heading }: { heading: number }) {
  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox="0 14 400 276"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Front elevation of the building, drawn placeholder, camera heading ${heading} degrees`}
        className="plate"
      >
        <g stroke="var(--ink)" fill="none" strokeWidth="2" strokeLinejoin="miter">
          {/* neighbours, cropped */}
          <path d="M0 120 L50 96 L50 272 L0 272 Z" stroke="var(--carbon)" strokeWidth="1.5" />
          <path d="M400 120 L350 96 L350 272 L400 272 Z" stroke="var(--carbon)" strokeWidth="1.5" />
          {/* roof + chimney */}
          <path d="M46 98 L200 38 L354 98" />
          <rect x="296" y="24" width="24" height="52" />
          <path d="M56 98 L344 98" />
          {/* facade */}
          <path d="M60 98 L60 272 L340 272 L340 98" />
          {/* brick courses */}
          <g stroke="var(--paper-edge)" strokeWidth="1">
            {[118, 138, 158, 178, 198, 218, 238, 258].map((y) => (
              <line key={y} x1="62" y1={y} x2="338" y2={y} />
            ))}
          </g>
          {/* first floor windows */}
          <rect x="96" y="118" width="66" height="52" fill="var(--paper)" />
          <line x1="129" y1="118" x2="129" y2="170" strokeWidth="1.5" />
          <rect x="232" y="118" width="66" height="52" fill="var(--paper)" />
          <line x1="265" y1="118" x2="265" y2="170" strokeWidth="1.5" />
          {/* bay */}
          <path d="M210 272 L210 190 L226 178 L296 178 L312 190 L312 272" fill="var(--paper)" />
          <line x1="226" y1="178" x2="226" y2="272" strokeWidth="1.5" />
          <line x1="296" y1="178" x2="296" y2="272" strokeWidth="1.5" />
          {/* front door, left of the bay */}
          <rect x="112" y="186" width="52" height="86" fill="var(--paper)" />
          <line x1="112" y1="200" x2="164" y2="200" strokeWidth="1.5" />
          <circle cx="156" cy="232" r="2.5" fill="var(--ink)" />
          {/* step + pavement */}
          <path d="M104 272 L172 272 L172 280 L104 280 Z" fill="var(--paper)" />
          <line x1="0" y1="280" x2="400" y2="280" strokeWidth="2.5" />
        </g>
        {/* the door, called out in red because it is incident state */}
        <g>
          <path d="M138 300 L138 292" stroke="var(--red)" strokeWidth="3" />
          <path d="M132 296 L138 288 L144 296 Z" fill="var(--red)" />
        </g>
      </svg>
    </figure>
  );
}

/** Plot from above: the terrace row, the plot, standing position, hydrant. */
export function PlotPlate() {
  return (
    <svg
      viewBox="0 16 400 274"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Plot from above, drawn placeholder: terrace row, appliance standing position and hydrant marker"
      className="plate"
    >
      {/* road */}
      <rect x="0" y="196" width="400" height="60" fill="color-mix(in oklch, var(--ink) 7%, transparent)" />
      <line x1="0" y1="226" x2="400" y2="226" stroke="var(--paper)" strokeWidth="3" strokeDasharray="14 12" />
      {/* terrace row */}
      <g stroke="var(--ink)" strokeWidth="2" fill="none">
        {[20, 96, 172, 248, 324].map((x) => (
          <rect key={x} x={x} y="84" width="70" height="98" fill="color-mix(in oklch, var(--ink) 4%, transparent)" />
        ))}
        {/* rear yards */}
        {[20, 96, 172, 248, 324].map((x) => (
          <rect key={`y${x}`} x={x} y="26" width="70" height="58" strokeDasharray="5 5" stroke="var(--carbon)" strokeWidth="1.5" />
        ))}
      </g>
      {/* the plot */}
      <rect x="172" y="84" width="70" height="98" fill="color-mix(in oklch, var(--red) 16%, transparent)" stroke="var(--red)" strokeWidth="3" />
      <text x="207" y="140" textAnchor="middle" className="plan-label" fill="var(--red)" fontSize="20">41</text>
      {/* side passage */}
      <line x1="245" y1="26" x2="245" y2="182" stroke="var(--carbon)" strokeWidth="1.5" strokeDasharray="4 4" />
      {/* appliance standing position */}
      <g>
        <rect x="104" y="204" width="86" height="30" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeDasharray="7 5" />
        <text x="147" y="224" textAnchor="middle" className="plan-label" fill="var(--ink)" fontSize="15">Stand</text>
      </g>
      {/* hydrant marker */}
      <g>
        <rect x="292" y="262" width="18" height="18" fill="var(--ink)" />
        <text x="316" y="277" className="plan-label" fill="var(--ink)" fontSize="15">Hydrant</text>
      </g>
      {/* front door approach */}
      <path d="M207 204 L207 182" stroke="var(--red)" strokeWidth="4" />
      <path d="M200 190 L207 178 L214 190 Z" fill="var(--red)" />
    </svg>
  );
}

/** Listing photo stand-in, drawn as an interior line study. */
export function PhotoPlate({ caption }: { caption: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Listing photo placeholder: ${caption}`}
      className="plate"
    >
      <rect x="0.75" y="0.75" width="198.5" height="138.5" fill="none" stroke="var(--paper-edge)" strokeWidth="1.5" />
      <g stroke="var(--carbon)" strokeWidth="1.5" fill="none">
        <path d="M0 108 L64 84 L136 84 L200 108" />
        <path d="M64 84 L64 24 L136 24 L136 84" />
        <path d="M0 22 L64 24 M136 24 L200 22" />
        <rect x="84" y="40" width="32" height="30" />
        <path d="M20 140 L44 96 L92 96 L74 140" />
      </g>
      <g stroke="var(--paper-edge)" strokeWidth="1">
        <line x1="8" y1="8" x2="8" y2="20" />
        <line x1="8" y1="8" x2="20" y2="8" />
        <line x1="192" y1="132" x2="192" y2="120" />
        <line x1="192" y1="132" x2="180" y2="132" />
      </g>
    </svg>
  );
}

/**
 * The full-bleed brief. A drawn one-point perspective of the casualty's room
 * standing in for the rendered walkthrough, so the phase-two composition is
 * real before fal or VEED is wired in.
 */
export function ReconstructionFilm() {
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Placeholder reconstruction of the back bedroom, drawn in perspective, with the smoke layer, the casualty position and the way in marked"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <rect width="1600" height="900" fill="var(--void)" />

      {/* tonal separation: floor reads lighter than the walls, so the volume
          holds without any decorative gradient */}
      <path d="M120 900 L520 640 L1080 640 L1480 900 Z" fill="oklch(0.2 0.008 250)" />
      <path d="M120 0 L520 250 L520 640 L120 900 Z" fill="oklch(0.145 0.007 250)" />
      <path d="M1480 0 L1080 250 L1080 640 L1480 900 Z" fill="oklch(0.145 0.007 250)" />
      <rect x="520" y="250" width="560" height="390" fill="oklch(0.165 0.007 250)" />

      <g stroke="var(--steel-ink)" fill="none" strokeWidth="3.5" strokeLinejoin="miter">
        <rect x="520" y="250" width="560" height="390" />
        <path d="M520 250 L120 0 M1080 250 L1480 0 M520 640 L120 900 M1080 640 L1480 900" />
        <g strokeWidth="1.5" opacity="0.45">
          {[1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M${520 + i * 93} 640 L${120 + i * 272} 900`} />
          ))}
        </g>
        {/* window, rear aspect */}
        <rect x="770" y="330" width="200" height="180" strokeWidth="4" />
        <line x1="870" y1="330" x2="870" y2="510" strokeWidth="2" />
        <line x1="770" y1="420" x2="970" y2="420" strokeWidth="2" />
        {/* door to the landing */}
        <path d="M520 300 L586 330 L586 610 L520 640" strokeWidth="4" />
        {/* bed */}
        <path d="M600 700 L600 560 L900 560 L900 730 Z" strokeWidth="4" />
        <path d="M600 604 L900 604" strokeWidth="2" opacity="0.7" />
        <path d="M600 560 L556 542 L556 630 L600 660" strokeWidth="2.5" opacity="0.8" />
      </g>

      {/* smoke layer — a hazard, so it is red and it is labelled */}
      <path d="M120 0 L1480 0 L1480 196 L120 196 Z" fill="var(--red)" opacity="0.2" />
      <path d="M120 198 L1480 198" stroke="var(--red-lit)" strokeWidth="3" strokeDasharray="20 12" />
      <text x="1462" y="240" textAnchor="end" className="plan-label" fill="var(--red-lit)" fontSize="30">
        Smoke layer
      </text>

      {/* casualty */}
      <g>
        <circle cx="700" cy="600" r="54" fill="none" stroke="var(--red-lit)" strokeWidth="6" />
        <circle cx="700" cy="600" r="12" fill="var(--red-lit)" />
        <path d="M754 600 L868 600" stroke="var(--red-lit)" strokeWidth="4" />
        <text x="884" y="592" className="plan-label" fill="var(--red-lit)" fontSize="34">
          Casualty
        </text>
        <text x="884" y="630" className="plan-label" fill="var(--red-lit)" fontSize="22" opacity="0.85">
          On the bed, head to the window
        </text>
      </g>

      {/* the way in — kept inside the vertical safe band, because the frame
          is sliced to cover, and clear of the bottom-left corner, which the
          attachments menu owns whenever it is open */}
      <path d="M300 500 L430 540 L520 580" stroke="var(--hivis)" strokeWidth="8" fill="none" strokeDasharray="26 16" />
      <path d="M520 580 L478 570 L488 604 Z" fill="var(--hivis)" />
      <text x="300" y="474" className="plan-label" fill="var(--hivis)" fontSize="32">
        In from the landing
      </text>

    </svg>
  );
}
