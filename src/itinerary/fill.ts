/**
 * Fills the slots an AI reply left empty, or the whole trip when there is no AI reply, from our own
 * candidate ranking.
 *
 * Each day is walked in slot order, so every filled stop is chosen near the stop before it and the
 * day reads as one loop instead of zig-zagging: a missing slot takes the unused candidate with the
 * highest
 *   rank − NEAR_WEIGHT × km from the previous stop + PREFERRED_BONUS when its kind suits the slot
 * (cafes for breakfast and tea, restaurants for lunch and dinner). An empty day first picks an anchor,
 * the best unused sight with ANCHOR_SPREAD_PENALTY taken off sights within ANCHOR_SPREAD_KM of
 * earlier days' anchors, so each day covers a different part of the city; the anchor is its first
 * morning stop and the walk starts there (breakfast near the first sight), otherwise at the base.
 * Empty days get two sights in each sight slot; a day the AI planned only gets its missing slots.
 */
import { haversineMeters, type LngLat } from "../geo/geometry.js";
import type { Candidate, EateryKind } from "./candidates.js";
import type { Pick } from "./prompt.js";
import { isMeal, type Slot } from "./trip.js";

const NEAR_WEIGHT = 1;
const PREFERRED_BONUS = 0.8;
const ANCHOR_SPREAD_KM = 2.5;
const ANCHOR_SPREAD_PENALTY = 3;
const EMPTY_DAY_SIGHTS_PER_SLOT = 2;
const PREFERRED: Partial<Record<Slot, EateryKind>> = { breakfast: "cafe", snack: "cafe", lunch: "restaurant", dinner: "restaurant" };

const km = (a: LngLat, b: LngLat) => haversineMeters(a, b) / 1000;

export function fillGaps(
  picks: readonly Pick[],
  candidates: readonly Candidate[],
  days: number,
  slots: readonly Slot[],
  base: LngLat,
): Pick[] {
  const used = new Set(picks.map((p) => p.candidate.ref));
  const result = [...picks];
  const anchors: LngLat[] = [];

  const best = (type: Candidate["type"], score: (c: Candidate) => number) => {
    let top: Candidate | undefined;
    let topScore = -Infinity;
    for (const c of candidates) {
      if (used.has(c.ref) || c.type !== type) continue;
      const value = score(c);
      if (value > topScore) {
        top = c;
        topScore = value;
      }
    }
    return top;
  };
  const take = (day: number, slot: Slot, candidate: Candidate) => {
    used.add(candidate.ref);
    result.push({ day, slot, candidate });
  };

  for (let day = 0; day < days; day++) {
    const empty = !result.some((p) => p.day === day);
    let here = base;
    if (empty && slots.includes("morning")) {
      const spread = (c: Candidate) => (anchors.some((a) => km(a, c.point) < ANCHOR_SPREAD_KM) ? ANCHOR_SPREAD_PENALTY : 0);
      const anchor = best("see", (c) => c.rank - spread(c));
      if (anchor) {
        take(day, "morning", anchor);
        anchors.push(anchor.point);
        here = anchor.point;
      }
    }

    for (const slot of slots) {
      const inSlot = () => result.filter((p) => p.day === day && p.slot === slot);
      const wanted = isMeal(slot) ? 1 : empty ? EMPTY_DAY_SIGHTS_PER_SLOT : 1;
      here = inSlot().at(-1)?.candidate.point ?? here;
      while (inSlot().length < wanted) {
        const from = here;
        const next = best(isMeal(slot) ? "eat" : "see", (c) => c.rank - NEAR_WEIGHT * km(from, c.point) + (PREFERRED[slot] === c.kind ? PREFERRED_BONUS : 0));
        if (!next) break;
        take(day, slot, next);
        here = next.point;
      }
    }
  }
  return result;
}
