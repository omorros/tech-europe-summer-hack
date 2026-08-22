# SizeUp golden properties (demo list)

Five sold listings, every one verified through the full live pipeline on the
day: live Holo agent found each listing on Rightmove sold prices, floor plan
and 12-photo gallery extracted, room graph built, and the actual fetched
Street View imagery was cross-checked by eye against each listing's own
exterior photos (not just the coverage flag). Results cached in
`backend/cache/` as the demo fallback. Say the address naturally on the fake
call; the pipeline does the rest.

## 1. 22 Kellett Road, London SW2 1EB — the headliner

- Victorian mid-terrace (Flat 1), rooms across two levels: dining room,
  kitchen, 2 bedrooms, bathroom, garden and patio.
- Street View: excellent, classic Brixton terrace with stucco arch.
- Fully cached end to end including the room graph.
- Call script: "22 Kellett Road in Brixton... SW2 1EB. The kitchen's on fire,
  my mum's in the back bedroom, she can't get out."
- Why it demos: our most rehearsed property; approach read nails the door,
  the bins, the parked cars, no rear access.

## 2. 14 Deerdale Road, London SE24 0AW — best exterior

- Ground-floor flat in a red-brick Victorian terrace: reception room,
  2 bedrooms, kitchen, pantry, long garden with shed.
- Listing has 36 photos, the best gallery of the set; crisp exterior shot
  matches Street View almost frame for frame (the grey-and-red front door
  pair is visible in both, verified).
- Call script: "14 Deerdale Road, Herne Hill, SE24 0AW. Fire in the kitchen
  at the back, my dad's in the front bedroom."
- Why it demos: the judges see the same building twice, once from Google,
  once from the listing. Strong "that is the actual house" moment.

## 3. 14b Deerbrook Road, London SE24 9BE — clearest floor plan

- First-floor maisonette: kitchen/reception/dining, 2 bedrooms, bathroom,
  roof terrace. Entrance is marked "IN" on the floor plan itself.
- Call script: "14b Deerbrook Road, SE24 9BE. Smoke's coming up the stairs,
  my son is in the front bedroom by the bay window."
- Why it demos: upstairs flat means the route has to go up the internal
  stair; bright modern kitchen photos reconstruct beautifully.
- Caveat: a van is parked in front of the facade in the current Street View
  capture; the building is still identifiable but it is the weakest exterior
  of the five.

## 4. 103b Norwood Road, London SE24 9AE — the multi-floor showpiece

- Two-storey post-war house, the biggest of the set: 26-foot reception on
  the ground floor, planted courtyard garden with internal walkway, FOUR
  bedrooms plus bathroom on the first floor.
- Verified: the vegetable beds, path and arch in the listing's garden photo
  are visible in the Street View foreground, same plot beyond doubt.
- Call script: "103b Norwood Road, SE24 9AE. Fire's in the big living room
  downstairs, my grandmother is upstairs in the back bedroom."
- Why it demos: route planning crosses floors, and the unusual courtyard
  layout shows the room graph handling a non-trivial building.

## 5. 61b Salford Road, London SW2 4BE — the contrast case

- Second-floor flat: 2 double bedrooms, reception, kitchen, bathroom.
- Call script: "61b Salford Road, SW2 4BE, it's the top flat. Fire in the
  kitchen, my flatmate's in bedroom 2 at the back."
- Why it demos: a victim two storeys up changes the approach conversation
  (ladder access, front windows), good for a Q&A follow-up.

## Notes for the demo

- Lead with Kellett Road or Deerdale Road; keep the others as encores or for
  judge-requested reruns.
- Every address was found by the agent via postcode search, so say the
  postcode clearly on the call: it is the string the extractor fires on.
- All caches warm: if anything upstream hiccups on stage, the pipeline
  degrades to these cached results automatically.
