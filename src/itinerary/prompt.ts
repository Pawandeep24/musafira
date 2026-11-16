/**
 * The AI half of the itinerary: a compact prompt in, a compact line format out.
 *
 * Prompt: fixed rules (system) plus one line per candidate, "<ref> <name>|<area>|<tags>", grouped as
 * Sights and Eateries. Input tokens are cheap, so we send a few hundred candidates (≈ 5k tokens).
 *
 * Reply, one item per line and nothing else:
 *   T <trip title>
 *   <day> <slot code> <ref> <note>      e.g. "1 B 81 Benne masala dosa"
 * Slot codes: B breakfast, M morning sight, L lunch, A afternoon sight, S evening snack, D dinner.
 * Lines beat JSON on output tokens (no repeated keys, quotes or brackets), a reply cut off at
 * max_tokens still yields every complete line, and each line is checked on its own: day in range,
 * slot offered, ref in our list with the right type (eateries for meals, sights for M/A), no repeats.
 * Anything else is dropped, so the model cannot add a place we don't have. The model never returns
 * times, routes or ratings; the scheduler computes times and gaps are filled from our ranking.
 */
import type { TextRequest } from "#src/planner/ports.js";
import type { Candidate } from "#src/itinerary/candidates.js";
import { dayCount, isMeal, type Slot, type TripRequest } from "#src/itinerary/trip.js";

export interface Pick {
  readonly day: number;
  readonly slot: Slot;
  readonly candidate: Candidate;
  readonly note?: string;
}

export interface ParsedReply {
  readonly title?: string;
  readonly picks: readonly Pick[];
}

const CODE: Record<Slot, string> = { breakfast: "B", morning: "M", lunch: "L", afternoon: "A", snack: "S", dinner: "D" };
const SLOT_BY_CODE = new Map(Object.entries(CODE).map(([slot, code]) => [code, slot as Slot]));
const TOKENS_PER_DAY = 100;
const TITLE_TOKENS = 40;
const MAX_NOTE_LENGTH = 60;
const MAX_TITLE_LENGTH = 48;
const MAX_SIGHTS_PER_SLOT = 2;
const PICK_LINE = /^(\d)\s+([A-Z])\s+(\d+)\s*(.*)$/;
const TITLE_LINE = /^T\s+(.+)$/;

const SYSTEM = `You plan two-wheeler day trips in Indian cities for Musafira, a safety-first riding app.
Choose stops ONLY from the numbered places in the message. Never invent places.
Reply with plain lines and nothing else:
T <trip title, at most 6 words>
<day> <slot> <place number> <note, at most 6 words>
Slots: B breakfast, M morning sight, L lunch, A afternoon sight, S evening snack or tea, D dinner.
Each day: exactly one line for each meal slot offered (B, L, S, D) using eateries; one or two lines each for M and A using sights.
Use only the slots offered. Keep a day's stops close together and use different areas on different days.
Prefer well-known local favourites and food the area is known for; skip chains.
Diet veg: only places you know are vegetarian. Diet egg: no meat-focused places.
Notes say what to eat or why to go, in plain words. No ratings, prices or opening hours.`;

const tags = (c: Candidate) => [c.kind, ...(c.famous ? ["famous"] : []), ...(c.veg ? ["veg"] : [])].join(",");
const line = (c: Candidate) => `${c.ref} ${c.name}|${c.area ?? "-"}|${tags(c)}`;

export function buildPrompt(trip: TripRequest, slots: readonly Slot[], candidates: readonly Candidate[]): TextRequest {
  const days = trip.days === 0.5 ? "Half a day" : `${trip.days} day${trip.days > 1 ? "s" : ""}`;
  const header = [
    `Trip: ${days} from ${trip.base.name}. Slots each day: ${slots.map((s) => CODE[s]).join(" ")}.`,
    `Interests: ${trip.interests.join(", ") || "a bit of everything"}. Diet: ${trip.diet}.`,
  ];
  const sights = candidates.filter((c) => c.type === "see").map(line);
  const eateries = candidates.filter((c) => c.type === "eat").map(line);
  return {
    system: SYSTEM,
    prompt: [...header, "Sights:", ...sights, "Eateries:", ...eateries].join("\n"),
    maxTokens: TITLE_TOKENS + TOKENS_PER_DAY * dayCount(trip.days),
  };
}

const clean = (text: string, max: number) =>
  text
    .replace(/["*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function parseReply(text: string, candidates: readonly Candidate[], days: number, slots: readonly Slot[]): ParsedReply {
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const offered = new Set(slots);
  const used = new Set<number>();
  const picks: Pick[] = [];
  let title: string | undefined;

  for (const raw of text.split("\n")) {
    const row = raw.trim().replace(/^[-*•]\s*/, "");
    const titled = TITLE_LINE.exec(row);
    if (titled) {
      title ??= clean(titled[1]!, MAX_TITLE_LENGTH) || undefined;
      continue;
    }
    const match = PICK_LINE.exec(row);
    if (!match) continue;
    const day = Number(match[1]) - 1;
    const slot = SLOT_BY_CODE.get(match[2]!);
    const candidate = byRef.get(Number(match[3]));
    if (day < 0 || day >= days || !slot || !offered.has(slot) || !candidate || used.has(candidate.ref)) continue;
    if ((candidate.type === "eat") !== isMeal(slot)) continue;
    const taken = picks.filter((p) => p.day === day && p.slot === slot).length;
    if (taken >= (isMeal(slot) ? 1 : MAX_SIGHTS_PER_SLOT)) continue;
    used.add(candidate.ref);
    const note = clean(match[4] ?? "", MAX_NOTE_LENGTH);
    picks.push({ day, slot, candidate, ...(note ? { note } : {}) });
  }
  return { ...(title ? { title } : {}), picks };
}
