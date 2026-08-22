---
name: SizeUp
description: A live 999 call, printing itself as the incident record it is.
colors:
  steel: "oklch(0.17 0.008 250)"
  void: "oklch(0.115 0.007 250)"
  edge: "oklch(0.3 0.01 250)"
  edge-soft: "oklch(0.24 0.009 250)"
  paper: "oklch(0.972 0.002 250)"
  paper-edge: "oklch(0.885 0.003 250)"
  ink: "oklch(0.19 0.01 250)"
  carbon: "oklch(0.52 0.008 250)"
  red: "oklch(0.505 0.205 25)"
  red-lit: "oklch(0.675 0.185 25)"
  hivis: "oklch(0.885 0.18 98)"
  steel-ink: "oklch(0.93 0.004 250)"
  steel-dim: "oklch(0.63 0.008 250)"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, min(3.1vw, 5.4vh), 3.4rem)"
    fontWeight: 800
    lineHeight: 0.94
    letterSpacing: "-0.02em"
    fontVariation: "wdth 82"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(14px, 0.92vw, 17px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.07em"
    fontVariation: "wdth 88"
  body:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "clamp(14px, 0.92vw, 17px)"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  margin:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  none: "0"
spacing:
  hairline: "1px"
  tight: "0.5rem"
  sheet: "1rem"
  gap: "1.1rem"
components:
  stamp-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.5em 0.75em 0.45em"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  sheet-pending:
    backgroundColor: "transparent"
    textColor: "{colors.steel-dim}"
    rounded: "{rounded.none}"
    padding: "1.6rem 1rem"
  entity-stamp:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.none}"
    padding: "0.16em 0.5em 0.2em"
  control:
    backgroundColor: "transparent"
    textColor: "{colors.hivis}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.62em 1.1em 0.56em"
  control-solid:
    backgroundColor: "{colors.hivis}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.62em 1.1em 0.56em"
  dial:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "1.1em 1em"
  field:
    backgroundColor: "{colors.void}"
    textColor: "{colors.steel-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.6em 0.8em"
---

# Design System: SizeUp

## Overview

**Creative North Star: "The Incident Log"**

A fire control room's teleprinter roll, running on a screen. The console is not a dashboard watching an incident from outside it — it is the incident record, writing itself while the call is still connected. Everything else on the screen is an attachment pinned off that roll.

The material logic is a printed record lying on dark steel. The roll is true white with black ink, because that is the highest contrast available and the screen has to stay readable in bright daylight and in a blacked-out room with nobody touching a setting. The ground around it is near-black steel so nothing glares back under stage light. There are no rounded corners anywhere: printed records do not have them.

Rank is carried the way a printed operational document carries it — by weight, case, reversal and rule — not by a ladder of sizes. There are exactly two type sizes in content, and the gap between them is enormous, so the screen ranks itself for someone reading it from four metres away. What this rejects, deliberately, is the category default: a slate-grey grid of equal glowing cards with cyan status pills.

**Key Characteristics:**
- A printed white roll on near-black steel; square corners throughout
- Two content type sizes, no middle; rank by weight, case, reversal and rule
- Colour reports facts and nothing else
- Deep dark voids instead of card chrome
- Every state carries a drawn mark and a word, never colour alone

## Colors

A two-material palette — printed paper and dark steel — with two signal colours that are only ever allowed to report a fact.

### Primary
- **Fire Red** (`oklch(0.505 0.205 25)`): incident state on paper. Extracted entities, hazard hatching on the floor plan, the route line, pins, the front-door callout on the elevation. Never a heading colour, never a section colour.
- **Lit Red** (`oklch(0.675 0.185 25)`): the same signal raised to survive the dark ground. The casualty line in the console header, the smoke layer and casualty marker on the brief, error state in the pipeline, the SYNTHETIC stamp.

### Secondary
- **Hi-Vis Yellow** (`oklch(0.885 0.18 98)`): the operator's own actions and nothing else. Controls, the caret, text selection, the focus ring, the way-in route on the brief, radio-originated lines in the record.

### Neutral
- **Paper** (`oklch(0.972 0.002 250)`): the roll and every attachment sheet. A true cool white, not cream — chroma 0.002 is effectively neutral.
- **Paper Edge** (`oklch(0.885 0.003 250)`): hairlines, rules, and the divider between the sprocket margin and the record.
- **Ink** (`oklch(0.19 0.01 250)`): finalised record text, drawn linework, and the fill of reversed stamp bars.
- **Carbon** (`oklch(0.52 0.008 250)`): unfinalised transcript, system and agent lines, plan labels, margin numerals. The colour of something printed but not yet struck.
- **Steel** (`oklch(0.17 0.008 250)`): the ground the record lies on.
- **Void** (`oklch(0.115 0.007 250)`): the darker field the attachments are pinned into, and the field behind the brief.
- **Edge** (`oklch(0.3 0.01 250)`) / **Edge Soft** (`oklch(0.24 0.009 250)`): dividers and dashed pending frames on the dark ground.
- **Steel Ink** (`oklch(0.93 0.004 250)`) / **Steel Dim** (`oklch(0.63 0.008 250)`): primary and secondary text on the dark ground.

### Named Rules
**The Reporting Rule.** Red and hi-vis are the only chromatic colours in the system, and each has exactly one job: red reports incident state, hi-vis reports the operator's own actions. If a colour on screen is not reporting a fact, it comes out. There is no brand colour, no section colour, and no accent used for emphasis.

**The Never-Alone Rule.** No state is encoded in colour alone. Every pipeline state carries a drawn mark and the word; every plan pin carries a letter and a legend entry; the casualty header carries the word "Casualty". Red and green is the exact pairing colourblind viewers lose, and this product's states are life-safety states.

## Typography

**Display Font:** Archivo (variable `wdth` axis, with system-ui fallback)
**Body Font:** Courier Prime (with Courier New fallback)

**Character:** A signage grotesque compressed to 82–88% width against a true typewriter mono. Archivo is a workhorse designed for printed forms and highlighting; Courier Prime is the record itself. The pairing is a form and the typing on it — maximum contrast on both axes (proportional vs monospaced, condensed heavy vs light typewriter), so nothing in the middle is needed.

### Hierarchy
- **Display** (800, `clamp(1.6rem, min(3.1vw, 5.4vh), 3.4rem)`, 0.94, -0.02em, uppercase, `wdth 82`): the address, the casualty line, and page-level headings. Capped against viewport height as well as width so it commands the screen without eating it.
- **Label** (700, record size, 0.07em, uppercase, `wdth 84–88`): every label in the system — stamp bars, fact keys, pipeline names, plan labels, controls. Same size as body; rank comes from case, weight, letter-spacing and reversal.
- **Body** (400, `clamp(14px, 0.92vw, 17px)`, 1.55): the record, sheet content, captions. Tabular numerals throughout.
- **Margin** (400, 11px): sprocket-margin sequence numbers and elapsed timestamps only.

### Named Rules
**The Two Sizes Rule.** Content is set at exactly two sizes: record and display, with nothing between them. The 11px margin size is mechanics — sequence numbers and timestamps — and may never carry prose. Anything that needs to outrank body text does it with case, weight, or a reversed bar, never by inching up a scale.

## Layout

The console is a fixed two-column screen at `100dvh` with no page scroll. Column one is the roll, spanning every row floor to ceiling — the record starts at the very top-left corner of the screen and runs to the bottom edge. Column two carries the header, then the attachment area. The attachment area is a two-column grid whose right cell is the tall one, because the building plan is the artifact the whole flow is for.

Regions are separated by deep dark voids and a single hairline, never by card chrome or a gutter of rounded containers. Gaps are `1.1rem`; sheet padding is `0.9rem 1rem 1.05rem`; the stamp bar sits tight at `0.5em 0.75em 0.45em`.

Below 1100px the grid collapses to one column with explicit placement — header, roll at 42dvh, then attachments stacked — and the page is allowed to scroll. Plates drop their height cap at that width and take their natural aspect.

## Elevation & Depth

Depth is real but sparse: printed sheets lying on a dark surface, lit from above. Every shadow carries a genuine offset and a soft blur — there are no zero-offset halos and no glow. Nothing on the dark ground is elevated; only paper is.

### Shadow Vocabulary
- **Roll** (`box-shadow: 8px 0 34px -8px rgb(0 0 0 / 0.85)`): the roll casting sideways onto the steel.
- **Sheet** (`box-shadow: 0 20px 44px -16px rgb(0 0 0 / 0.85)`): an attachment pinned into the void.
- **Entry sheet** (`box-shadow: 0 26px 60px -20px rgb(0 0 0 / 0.9)`): the single sheet on the address page, lifted further because it is alone on the screen.

### Named Rules
**The Paper-Only Rule.** Shadow means paper. A pending sheet has no shadow at all — it is a dashed outline in the void, because there is no document there yet. Nothing on the steel ground is ever elevated.

## Shapes

Radius is zero everywhere, without exception. Printed records, stamp bars, sheets, controls, fields, pins and legend marks are all square. The only curve in the system is a circle used as a distinct mark shape — the stairs marker and the entry point on the plan, and the casualty ring on the brief — where circle-versus-square is carrying information.

Borders are hairlines: `1px` on paper edges and sheet outlines, `1.5px` on entity stamps and controls where the border is the object, `3px` on the address field's underline. The pending state is the same geometry rendered as a dashed `1px` outline in the void.

## Components

### Stamp bar
- **Character:** a reversed header strip; the system's only label device.
- **Shape:** square, full-bleed across its sheet.
- **Default:** ink ground, paper text, uppercase Archivo at record size, `0.07em` tracking.
- **On dark:** `stamp-bar--steel` drops the fill entirely and keeps a `1px` bottom rule in edge.

### Sheet (attachment)
- **Corner Style:** square, no radius.
- **Background:** paper; `1px` paper-edge border; sheet shadow.
- **Pending:** transparent ground, `1px` dashed edge border, no shadow, steel-dim text, content centred — and it always states what is missing and who owes it, never a spinner.
- **Internal Padding:** `0.9rem 1rem 1.05rem`.

### Entity stamp
- **Character:** a rubber stamp pressed into the line where the thing was said.
- **Style:** `1.5px` red border, transparent fill, red text, rotated `-0.7deg`, label + value on one baseline.
- **Motion:** a `stamp-press` from `scale(1.28) rotate(-3.2deg)` to rest on `ease-out-quint`.
- **Radio variant:** ink border and text instead of red, on a hi-vis-tinted line — the source, not the severity, is what changes.

### Log line
- **Character:** one printed line of the record.
- **Structure:** a 58px sprocket margin holding sequence number and elapsed time, punched with radial holes that read through to the steel behind, then the body.
- **States:** partial prints in carbon with a blinking block caret; final strikes to ink over 200ms.

### Buttons
- **Shape:** square, `1.5px` border.
- **Primary (`control`):** hi-vis border and text on transparent; hover inverts to a hi-vis fill with ink text.
- **Solid (`control--solid`):** starts filled and inverts on hover.
- **On paper (`control--ink`):** ink border and text, inverting to an ink fill.
- **Dial (`/phone`):** a full-width red block, `clamp(1.6rem, 7vw, 2.4rem)`, no border; the end-call variant is an outlined lit-red ghost.
- **Disabled:** edge border, steel-dim text, `not-allowed`.

### Inputs
- **On dark (`field`):** void ground, `1.5px` edge border, hi-vis caret; focus swaps the border to hi-vis and suppresses the default outline.
- **On paper (`field--paper`):** no box at all — a `3px` ink underline that turns red on focus, with a red caret.

### Floor plan
- **Character:** a drafted plan, not a data visualisation.
- **Rooms:** `2.5px` ink stroke, 4% ink fill; the fire room takes a 22% red fill plus 45° red hatching; the casualty room takes a 10% ink fill.
- **Pins:** solid red squares with a reversed letter (F, C, X) and circles for stairs and entry, each named in a legend row beneath the plan.
- **Route:** `7px` red polyline, square caps, drawn in with `stroke-dashoffset` over 1400ms on `ease-out-expo`; a floor change breaks the line and marks both ends rather than drawing a corridor that does not exist.

### Placeholder plates
- **Character:** authored line drawings in the record's own drafting grammar, standing in for imagery no lane has delivered yet.
- **Style:** ink and carbon strokes on paper, `preserveAspectRatio="xMidYMid meet"`, height-capped inside console panels and released to natural size inside an attachment window.
- **Rule:** every one is stamped SYNTHETIC and listed in the replace list at the top of `plates.tsx`.

## Do's and Don'ts

### Do:
- **Do** state what is missing and which lane owes it. A pending panel says "Not reported" plus the reason; a spinner that never resolves is a lie.
- **Do** give every state a drawn mark and a word alongside its colour.
- **Do** keep radius at 0 and let a circle mean something when it appears.
- **Do** theme the browser's own surfaces from the palette — selection, caret, focus ring, scrollbars — and set `font-variant-numeric: tabular-nums` globally.
- **Do** pair every animation with a `prefers-reduced-motion` alternative, including the entity stamp, the line entrance, the route draw and the phase transformation.
- **Do** ease out exponentially (`ease-out-quint` at `cubic-bezier(0.23, 1, 0.32, 1)`, `ease-out-expo` at `cubic-bezier(0.16, 1, 0.3, 1)`).

### Don't:
- **Don't** introduce a third content type size, and never set prose at the 11px margin size.
- **Don't** colour anything that is not reporting a fact — no brand colour, no section colour, no accent for emphasis.
- **Don't** put a label above a heading. The heading carries its own weight.
- **Don't** use rounded corners, glass, blur-as-decoration, gradient text, or a glowing status pill.
- **Don't** build a grid of equal cards. Regions are separated by dark voids and hairlines.
- **Don't** animate perpetually. Motion is a response to an event arriving, never ambient.
- **Don't** let a panel scroll-cut its own sentence; move the overflow to an attachment window and say so in the sheet header.
