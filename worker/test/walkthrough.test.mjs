/**
 * Leg planning, run against the real source.
 *   npm test        (from worker/)
 *
 * Deliberately no network: this checks the part that decides what the crew
 * sees — how a route becomes legs, and what each leg is told to render.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// Node strips the types on import, so this runs the real source file.
import { buildLegs, legNarration } from "../src/walkthrough.ts";
import {
  adapterFor,
  ADAPTERS,
  autoSeconds,
  DEFAULT_MODEL,
  estimateUsd,
} from "../src/models.ts";
import { pollBase, videoUrl } from "../src/fal.ts";

const REQUEST = {
  address: "23 Larkfield Road, London SE15 4ND",
  building_description: "mid-terrace house, two storeys, front door on the left",
  floorplan_description:
    "Ground floor: hallway front, lounge right, kitchen at the rear. First floor: landing, two bedrooms, bathroom.",
  route: [
    { room_id: "hallway", name: "Hallway", floor: 0 },
    { room_id: "landing", name: "Landing", floor: 1 },
    { room_id: "bedroom_back", name: "Back bedroom", floor: 1 },
  ],
  photos: {
    hallway: "https://example.com/hallway.jpg",
    landing: "https://example.com/landing.jpg",
    bedroom_back: "https://example.com/bedroom.jpg",
  },
  hazards: ["heavy smoke on the landing"],
  seconds_per_leg: 5,
};

test("a route of N rooms becomes N-1 legs, entrance first", () => {
  const legs = buildLegs(REQUEST);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].label, "Hallway → Landing");
  assert.equal(legs[1].label, "Landing → Back bedroom");
  assert.equal(legs[0].index, 0);
});

test("both ends of every leg are real photographs", () => {
  for (const leg of buildLegs(REQUEST)) {
    assert.ok(leg.start_image_url.startsWith("https://"));
    assert.ok(leg.end_image_url.startsWith("https://"));
  }
});

test("a missing photo fails loudly rather than inventing a room", () => {
  const broken = { ...REQUEST, photos: { hallway: "https://example.com/h.jpg" } };
  assert.throws(() => buildLegs(broken), /no photo for "landing"/);
});

test("a route shorter than two rooms is rejected", () => {
  assert.throws(
    () => buildLegs({ ...REQUEST, route: [{ room_id: "hallway" }] }),
    /at least two rooms/,
  );
});

test("going upstairs is described as climbing", () => {
  const legs = buildLegs(REQUEST);
  assert.match(legs[0].prompt, /climbs a staircase/);
  assert.doesNotMatch(legs[1].prompt, /staircase/);
});

test("the final leg ends facing the seat of the fire", () => {
  const legs = buildLegs(REQUEST);
  assert.match(legs[1].prompt, /seat of the fire/);
  assert.doesNotMatch(legs[0].prompt, /seat of the fire/);
});

test("the prompt forbids inventing layout and states the house is empty", () => {
  const [leg] = buildLegs(REQUEST);
  assert.match(leg.prompt, /Keep the room layout exactly as shown/);
  // Positive framing, not "no people" — the negative phrasing put a
  // firefighter in our first real render.
  assert.match(leg.prompt, /completely deserted/);
  assert.match(leg.prompt, /no firefighters/i);
});

test("authored prompts override the template, per leg", () => {
  const legs = buildLegs({ ...REQUEST, leg_prompts: ["DIRECTED SHOT ONE"] });
  assert.equal(legs[0].prompt, "DIRECTED SHOT ONE");
  // leg 1 has no authored prompt, so it falls back to the template
  assert.match(legs[1].prompt, /helmet-camera/);
});

test("duration is clamped to the model's 3-10s range", () => {
  assert.equal(buildLegs({ ...REQUEST, seconds_per_leg: 99 })[0].duration, "10");
  assert.equal(buildLegs({ ...REQUEST, seconds_per_leg: 1 })[0].duration, "3");
  assert.equal(buildLegs({ ...REQUEST, seconds_per_leg: undefined })[0].duration, "5");
});

test("hazards are narrated on the leg that reaches them, as a sentence", () => {
  const legs = buildLegs(REQUEST);
  assert.match(legNarration(legs[0], REQUEST), /Heavy smoke on the landing\.$/);
  assert.doesNotMatch(legNarration(legs[1], REQUEST), /smoke/i);
});

test("the first leg's narration names the entry point", () => {
  const legs = buildLegs(REQUEST);
  assert.match(legNarration(legs[0], REQUEST), /^Entry via the Hallway/);
});

// --- continuous: one unbroken clip, entrance to the seat of the fire --------

const CONTINUOUS = { ...REQUEST, continuous: true, seconds_per_leg: undefined };

test("a continuous walk is one clip however many rooms the route has", () => {
  for (const rooms of [2, 3, 5, 9, 14]) {
    const legs = buildLegs({ ...route(rooms), continuous: true });
    assert.equal(legs.length, 1, `${rooms} rooms`);
  }
});

test("the single clip runs entrance to fire room, not entrance to next door", () => {
  const [leg] = buildLegs(CONTINUOUS);
  assert.equal(leg.label, "Hallway → Back bedroom");
  assert.equal(leg.from_room_id, "hallway");
  assert.equal(leg.to_room_id, "bedroom_back");
  assert.equal(leg.start_image_url, REQUEST.photos.hallway);
  assert.equal(leg.end_image_url, REQUEST.photos.bedroom_back);
});

test("rooms passed on the way are named in the prompt, since they are not shown", () => {
  const [leg] = buildLegs(CONTINUOUS);
  assert.match(leg.prompt, /single continuous take/);
  assert.match(leg.prompt, /passing the Landing/);
  assert.match(leg.prompt, /Do not cut\./);
  assert.match(leg.prompt, /completely deserted/);
});

test("a continuous walk takes the longest clip the model allows", () => {
  assert.equal(buildLegs(CONTINUOUS)[0].duration, "10");
  // ...and still honours an explicit shorter request.
  assert.equal(buildLegs({ ...CONTINUOUS, seconds_per_leg: 6 })[0].duration, "6");
});

test("a continuous walk needs no photo of the rooms in between", () => {
  const sparse = {
    ...CONTINUOUS,
    photos: { hallway: REQUEST.photos.hallway, bedroom_back: REQUEST.photos.bedroom_back },
  };
  const [leg] = buildLegs(sparse);
  assert.equal(leg.end_image_url, REQUEST.photos.bedroom_back);
  // ...but it cannot start from nothing.
  assert.throws(() => buildLegs({ ...CONTINUOUS, photos: {} }), /no photo for "hallway"/);
});

test("the continuous narration walks the whole route in one sentence", () => {
  const [leg] = buildLegs(CONTINUOUS);
  const line = legNarration(leg, CONTINUOUS);
  assert.match(line, /^Entry via the Hallway, through the Landing, to the Back bedroom/);
  assert.match(line, /heavy smoke on the landing/i);
});

test("one continuous clip costs well under the ceiling", () => {
  const kling = adapterFor(DEFAULT_MODEL);
  assert.ok(estimateUsd(kling, 1, 10) <= 1.5);
});

// --- buildings vary: a flat is one hop, a big house is ten ------------------

const route = (rooms) => ({
  route: Array.from({ length: rooms }, (_, i) => ({ room_id: `r${i}`, name: `Room ${i}` })),
  photos: Object.fromEntries(
    Array.from({ length: rooms }, (_, i) => [`r${i}`, `https://x/${i}.jpg`]),
  ),
});

test("any route length produces legs without special-casing", () => {
  for (const rooms of [2, 3, 5, 9, 14]) {
    assert.equal(buildLegs(route(rooms)).length, rooms - 1);
  }
});

test("clip length shrinks as the route grows, keeping total near target", () => {
  const kling = adapterFor(DEFAULT_MODEL);
  for (const legs of [1, 2, 5, 8, 11]) {
    const seconds = autoSeconds(kling, legs, 30);
    assert.ok(kling.durations.includes(seconds), `${seconds}s must be a legal duration`);
    // Short routes overshoot (a single hop can't be under 10s) but long ones
    // must not run away.
    if (legs >= 5) assert.ok(seconds * legs <= 40, `${legs} legs ran ${seconds * legs}s`);
  }
});

test("cost stays bounded as buildings get bigger", () => {
  const kling = adapterFor(DEFAULT_MODEL);
  const cost = (legs) => estimateUsd(kling, legs, autoSeconds(kling, legs, 30));
  // A 12-room house must not cost double a 4-room one.
  assert.ok(cost(11) < cost(3) * 1.5, `11 legs $${cost(11)} vs 3 legs $${cost(3)}`);
  for (const legs of [1, 3, 5, 8, 11, 15]) {
    assert.ok(cost(legs) <= 6, `${legs} legs would cost $${cost(legs).toFixed(2)}`);
  }
});

test("Veo only ever gets durations it accepts", () => {
  const veo = adapterFor("fal-ai/veo3.1/first-last-frame-to-video");
  for (const legs of [1, 2, 5, 11]) {
    assert.ok(veo.durations.includes(autoSeconds(veo, legs, 30)));
  }
});

// --- regressions found in review -------------------------------------------

test("an unmapped model has no price, so the budget ceiling cannot apply", () => {
  const unknown = adapterFor("vendor/model-we-never-priced");
  assert.ok(
    !Number.isFinite(estimateUsd(unknown, 5, 5)),
    "unpriced models must be non-finite so index.ts refuses them outright",
  );
  // ...while every mapped model must be priceable.
  for (const id of Object.keys(ADAPTERS)) {
    assert.ok(Number.isFinite(estimateUsd(adapterFor(id), 5, 5)), id);
  }
});

test("videoUrl returns null for every shape fal can send without a video", () => {
  for (const payload of [null, undefined, {}, { video: {} }, { video: null }]) {
    assert.equal(videoUrl(payload), null, JSON.stringify(payload));
  }
  assert.equal(videoUrl({ video: { url: "https://x/v.mp4" } }), "https://x/v.mp4");
  assert.equal(videoUrl({ video: "https://x/v.mp4" }), "https://x/v.mp4");
});

test("Veo's adapter never emits a duration outside 4/6/8s", () => {
  const veo = adapterFor("fal-ai/veo3.1/first-last-frame-to-video");
  for (const s of [1, 3, 5, 7, 9, 30, 100]) {
    const built = veo.build({ prompt: "p", startImageUrl: "a", endImageUrl: "b", seconds: s });
    assert.ok(["4s", "6s", "8s"].includes(built.duration), `${s} -> ${built.duration}`);
  }
});

test("Veo audio is always off — it silently doubles the per-second price", () => {
  for (const id of Object.keys(ADAPTERS)) {
    const built = adapterFor(id).build({
      prompt: "p", startImageUrl: "a", endImageUrl: "b", seconds: 5,
    });
    assert.notEqual(built.generate_audio, true, id);
  }
});

test("polling paths drop the model sub-path (found in production as a 405)", () => {
  // Submitting to fal-ai/kling-video/o1/image-to-video returns a status_url of
  // …/fal-ai/kling-video/requests/{id}/status — only two segments survive.
  assert.equal(pollBase("fal-ai/kling-video/o1/image-to-video"), "fal-ai/kling-video");
  assert.equal(pollBase("fal-ai/veo3.1/first-last-frame-to-video"), "fal-ai/veo3.1");
  assert.equal(pollBase("veed/fabric-1.0"), "veed/fabric-1.0");
  assert.equal(pollBase("fal-ai/kokoro/american-english"), "fal-ai/kokoro");
});
