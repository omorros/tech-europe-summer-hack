---
timestamp: 2026-08-22T13-22-21Z
slug: frontend-app-incident-console-page-tsx
---
{
  "target": "frontend/app/(incident)/console/page.tsx",
  "score": 2.4,
  "mode": "operate",
  "degraded": false,
  "summary": "Strong visual identity on a generic skeleton. The simplification pass removed the panels and the product's central claim went with them: automatic assembly became manual browsing. Detector clean.",
  "strengths": [
    "waitingOn language names the gap and the owing lane, never a spinner",
    "entity stamp pressed into the line where it was said",
    "floor plan breaks the route at a floor change rather than drawing a corridor that does not exist"
  ],
  "findings": [
    { "id": "no-arrival-signal", "severity": "p0", "title": "Nothing tells the operator that something new arrived; demo beats 4-6 need a click", "fix": "auto-follow newest ready attachment plus NEW mark", "status": "fixed" },
    { "id": "record-filter", "severity": "p0", "title": "Entity-only filter deleted partials, the carbon-to-ink strike and the caret; logline--partial could never render", "fix": "keep entity lines plus the line currently printing", "status": "fixed" },
    { "id": "no-status", "severity": "p1", "title": "Call state and all eight stage events render nowhere; error state unrenderable", "fix": "StatusLine under the address", "status": "fixed" },
    { "id": "video-cold", "severity": "p1", "title": "/video with no run draws a fabricated casualty scene with no empty state and no SYNTHETIC stamp", "fix": "empty state plus persistent stamp on the film", "status": "fixed" },
    { "id": "address-occluded", "severity": "p1", "title": "Address hidden behind the default-open panel; rail carried two redundant pairs", "fix": "header row spanning the stage; merge Plot into Approach; drop Brief tab", "status": "fixed" },
    { "id": "synthetic-contrast", "severity": "p1", "title": "SyntheticStamp red on ink stamp-bar at 2.82:1", "fix": "red-lit inside stamp bars, 5.77:1", "status": "fixed" },
    { "id": "rise-motion", "severity": "p2", "title": ".panel and .pop__window animate rise with no reduced-motion alternative", "fix": "added to the reduce block", "status": "fixed" },
    { "id": "aria-disabled-clickable", "severity": "p2", "title": "aria-disabled on tabs that remain clickable", "fix": "data-ready instead; click still shows the honest pending state", "status": "fixed" },
    { "id": "dead-code", "severity": "p2", "title": "rail/rail-row CSS, control--danger, gather, z-sheet, z-overlay, AgentShotPlate, radioBeats, emit", "fix": "removed", "status": "fixed" },
    { "id": "typed-address-discarded", "severity": "p2", "title": "/ discards the typed address and replays the demo address", "fix": "open", "status": "open" },
    { "id": "roving-tabindex", "severity": "p3", "title": "No arrow-key roving on either tab set", "fix": "number keys 1-4 added; arrow roving still open", "status": "partial" },
    { "id": "agentsteps-unread", "severity": "p3", "title": "agentSteps in state with no reader", "fix": "kept deliberately: agent.step is a locked event and the reducer must handle it", "status": "wontfix" }
  ]
}
