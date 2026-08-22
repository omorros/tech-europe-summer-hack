/** Keyword extractor. Same patterns as `backend/intelligence/extractor.py`. */

export type EntityType =
  | "ADDRESS"
  | "FIRE_ORIGIN"
  | "VICTIM_LOCATION"
  | "HAZARD_TYPE"
  | "EXIT";

export interface Entity {
  type: EntityType;
  value: string;
  confidence: number;
  source: "call" | "radio";
  ts: number;
}

const ROOM =
  "(?:(?:back|rear|front|spare|main|master|top|box)\\s+)?" +
  "(?:bed\\s?room|kitchen|bath\\s?room|lounge|living\\s?room|sitting\\s?room|" +
  "dining\\s?room|hall(?:way)?|landing|attic|loft|basement|cellar|garage|" +
  "conservatory|utility(?:\\s?room)?|stairs|staircase|toilet)";
const PERSON =
  "(?:mum|mom|mother|dad|father|grandma|grandmother|granddad|grandfather|" +
  "grandpa|nan|wife|husband|partner|son|daughter|baby|kids?|child(?:ren)?|" +
  "brother|sister|neighbour|someone|he|she|they)";
const HAZARD =
  "gas\\s+(?:bottle|cylinder|canister|leak)|oxygen\\s+(?:tank|cylinder)|" +
  "(?:thick\\s+|black\\s+|heavy\\s+)?smoke|gas|propane|butane|petrol|paraffin|" +
  "flashover|backdraft|explosion|chemicals?|paint\\s+thinners?|fireworks|" +
  "electrical\\s+(?:fault|fire)";
const EXITS =
  "(?:front|back|rear|side)\\s+(?:door|exit|entrance)|fire\\s+escape|" +
  "patio\\s+doors?|french\\s+doors?";
const APPLIANCE =
  "cooker|oven|stove|hob|boiler|fireplace|toaster|tumble\\s+dryer|washing\\s+machine|sofa|tv|television";

const STREET = new RegExp(
  "\\b(\\d{1,4}[a-z]?)\\s+((?:[a-z][a-z']+\\s+){1,3}?" +
    "(?:road|rd|street|lane|avenue|ave|grove|close|drive|way|terrace|" +
    "gardens|court|crescent|place|row|hill|mews|walk|square))\\b",
  "i",
);
const POSTCODE = /\b([a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2})\b/i;
const VICTIM_ROOM = new RegExp(
  `\\b${PERSON}\\b[^.!?]{0,60}?\\b(?:(upstairs|downstairs)\\s+)?(?:in|inside)\\s+(?:the\\s+|her\\s+|his\\s+|their\\s+|my\\s+)?(${ROOM})`,
  "i",
);
const VICTIM_FLOOR = new RegExp(
  `\\b${PERSON}\\b[^.!?]{0,40}?\\b(?:trapped|stuck|still)\\s+(upstairs|downstairs|inside)`,
  "i",
);
const FIRE = [
  new RegExp(
    `fire\\s+(?:started|began|broke\\s+out)\\s+(?:in|at|by|near)\\s+(?:the\\s+)?(${ROOM}|${APPLIANCE})`,
    "i",
  ),
  new RegExp(
    `(?:it|that|this)?\\s*(?:started|began|broke\\s+out)\\s+(?:in|at|by|near|from)\\s+(?:the\\s+)?(${ROOM}|${APPLIANCE})`,
    "i",
  ),
  new RegExp(`fire\\s+(?:is\\s+)?(?:in|at)\\s+(?:the\\s+)?(${ROOM}|${APPLIANCE})`, "i"),
  new RegExp(
    `(?:the\\s+)?(${ROOM}|${APPLIANCE})\\s*(?:is|'s|was|are)?\\s+(?:on\\s+fire|alight|ablaze|burning)`,
    "i",
  ),
  new RegExp(`flames?\\s+(?:in|from|coming\\s+from)\\s+(?:the\\s+)?(${ROOM}|${APPLIANCE})`, "i"),
];
const HAZARD_RE = new RegExp(
  `(${HAZARD})(?:\\s+(?:is|are)?\\s*(?:in|on|by|near|filling)\\s+(?:the\\s+)?(${ROOM}|${APPLIANCE}))?`,
  "gi",
);
const EXIT_RE = new RegExp(
  `(${EXITS})(?:\\s+(?:is|are|'s)?\\s*(blocked|locked|jammed|impassable|on\\s+fire))?`,
  "gi",
);

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class Dedupe {
  private fired = new Map<string, Map<string, string>>();

  check(type: string, value: string): boolean {
    const norm = normalise(value);
    if (!norm) return false;
    let seen = this.fired.get(type);
    if (!seen) {
      seen = new Map();
      this.fired.set(type, seen);
    }
    if (seen.has(norm)) return false;
    for (const prev of [...seen.keys()]) {
      if (prev.includes(norm)) return false;
      if (norm.includes(prev)) seen.delete(prev);
    }
    seen.set(norm, value);
    return true;
  }

  reset(): void {
    this.fired.clear();
  }
}

export function extract(text: string): { type: EntityType; value: string; confidence: number }[] {
  const found: { type: EntityType; value: string; confidence: number }[] = [];
  const street = STREET.exec(text);
  const postcode = POSTCODE.exec(text);
  if (street) {
    let value = `${street[1]} ${street[2]}`.trim();
    if (/\blondon\b/i.test(text)) value += ", London";
    if (postcode) value += ` ${postcode[1].toUpperCase()}`;
    found.push({ type: "ADDRESS", value, confidence: postcode ? 0.9 : 0.75 });
  } else if (postcode) {
    found.push({ type: "ADDRESS", value: postcode[1].toUpperCase(), confidence: 0.6 });
  }

  const victimRoom = VICTIM_ROOM.exec(text);
  if (victimRoom) {
    found.push({
      type: "VICTIM_LOCATION",
      value: [victimRoom[1], victimRoom[2]].filter(Boolean).join(" "),
      confidence: 0.8,
    });
  } else {
    const victimFloor = VICTIM_FLOOR.exec(text);
    if (victimFloor) {
      found.push({ type: "VICTIM_LOCATION", value: victimFloor[1], confidence: 0.6 });
    }
  }

  for (const pattern of FIRE) {
    const match = pattern.exec(text);
    if (match) {
      found.push({ type: "FIRE_ORIGIN", value: match[1], confidence: 0.85 });
      break;
    }
  }

  HAZARD_RE.lastIndex = 0;
  for (const match of text.matchAll(HAZARD_RE)) {
    const value = match[2] ? `${match[1]} in ${match[2]}` : match[1];
    found.push({ type: "HAZARD_TYPE", value, confidence: 0.75 });
  }

  EXIT_RE.lastIndex = 0;
  for (const match of text.matchAll(EXIT_RE)) {
    found.push({
      type: "EXIT",
      value: [match[1], match[2]].filter(Boolean).join(" "),
      confidence: 0.75,
    });
  }

  return found;
}
