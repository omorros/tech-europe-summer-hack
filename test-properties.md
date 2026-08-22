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
- Links: [Rightmove listing](https://www.rightmove.co.uk/house-prices/details/f9be2480-5595-46fe-a178-094e0a330986) | [Street View](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.4597725,-0.1138011) | [Google Maps](https://www.google.com/maps/search/?api=1&query=22%20Kellett%20Road%2C%20London%20SW2%201EB)
- Files: [floor plan](backend/static/artifacts/22-kellett-road-london-sw2-1eb/floorplan.png) | [room graph](backend/static/artifacts/22-kellett-road-london-sw2-1eb/roomgraph-debug.png) | [photos](backend/static/artifacts/22-kellett-road-london-sw2-1eb/) | [cached data](backend/cache/22-kellett-road-london-sw2-1eb/)
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
- Links: [Rightmove listing](https://www.rightmove.co.uk/house-prices/details/c9dea6e9-7e85-46d4-b982-ea84f9a0cf3a) | [Street View](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.4625013,-0.0988137) | [Google Maps](https://www.google.com/maps/search/?api=1&query=14%20Deerdale%20Road%2C%20London%20SE24%200AW)
- Files: [floor plan](backend/static/artifacts/14-deerdale-road-london-se24-0aw/floorplan.png) | [room graph](backend/static/artifacts/14-deerdale-road-london-se24-0aw/roomgraph-debug.png) | [photos](backend/static/artifacts/14-deerdale-road-london-se24-0aw/) | [cached data](backend/cache/14-deerdale-road-london-se24-0aw/)
- Call script: "14 Deerdale Road, Herne Hill, SE24 0AW. Fire in the kitchen
  at the back, my dad's in the front bedroom."
- Why it demos: the judges see the same building twice, once from Google,
  once from the listing. Strong "that is the actual house" moment.

## 3. 14b Deerbrook Road, London SE24 9BE — clearest floor plan

- First-floor maisonette: kitchen/reception/dining, 2 bedrooms, bathroom,
  roof terrace. Entrance is marked "IN" on the floor plan itself.
- Links: [Rightmove listing](https://www.rightmove.co.uk/house-prices/details/6f6e89d9-bfcc-4c49-aece-d3d98a2b7cfa) | [Street View](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.44314319999999,-0.1067525) | [Google Maps](https://www.google.com/maps/search/?api=1&query=14b%20Deerbrook%20Road%2C%20London%20SE24%209BE)
- Files: [floor plan](backend/static/artifacts/14b-deerbrook-road-london-se24-9be/floorplan.png) | [room graph](backend/static/artifacts/14b-deerbrook-road-london-se24-9be/roomgraph-debug.png) | [photos](backend/static/artifacts/14b-deerbrook-road-london-se24-9be/) | [cached data](backend/cache/14b-deerbrook-road-london-se24-9be/)
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
- Links: [Rightmove listing](https://www.rightmove.co.uk/house-prices/details/cc1f3491-f922-47b2-95e2-6f29f15fa7c1) | [Street View](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.4493727,-0.1009519) | [Google Maps](https://www.google.com/maps/search/?api=1&query=103b%20Norwood%20Road%2C%20London%20SE24%209AE)
- Files: [floor plan](backend/static/artifacts/103b-norwood-road-london-se24-9ae/floorplan.png) | [room graph](backend/static/artifacts/103b-norwood-road-london-se24-9ae/roomgraph-debug.png) | [photos](backend/static/artifacts/103b-norwood-road-london-se24-9ae/) | [cached data](backend/cache/103b-norwood-road-london-se24-9ae/)
- Call script: "103b Norwood Road, SE24 9AE. Fire's in the big living room
  downstairs, my grandmother is upstairs in the back bedroom."
- Why it demos: route planning crosses floors, and the unusual courtyard
  layout shows the room graph handling a non-trivial building.

## 5. 61b Salford Road, London SW2 4BE — the contrast case

- Second-floor flat: 2 double bedrooms, reception, kitchen, bathroom.
- Links: [Rightmove listing](https://www.rightmove.co.uk/house-prices/details/250f1325-af37-4979-94a9-9cdd71939de7) | [Street View](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.4408565,-0.1329616) | [Google Maps](https://www.google.com/maps/search/?api=1&query=61b%20Salford%20Road%2C%20London%20SW2%204BE)
- Files: [floor plan](backend/static/artifacts/61b-salford-road-london-sw2-4be/floorplan.png) | [room graph](backend/static/artifacts/61b-salford-road-london-sw2-4be/roomgraph-debug.png) | [photos](backend/static/artifacts/61b-salford-road-london-sw2-4be/) | [cached data](backend/cache/61b-salford-road-london-sw2-4be/)
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
