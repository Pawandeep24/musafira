/**
 * Turns picks into a timed plan, in the city's wall-clock time (utcOffsetMinutes), never the server's.
 *
 * Each day starts at DAY_START from the base and visits its picks in slot order. A leg's ride time
 * is estimated without a routing call (one per leg would load the public routing server), from
 *   minutes = straight-line km × ROAD_FACTOR ÷ RIDE_KMH × 60 + PARKING_MINUTES
 * rounded up to 5 minutes; riders open any leg in the route planner for the real, safety-scored route.
 * Meals wait for their hour (MEAL_FROM): the rider leaves later rather than arriving early.
 * The day must end back at base by `backBy`: civil dusk ("sunset", from suncalc at the base), 20:00 or
 * 22:00, and a half day by DAY_START + HALF_DAY_HOURS. A stop that would break that is dropped.
 * Opening hours are enforced only when OSM lists them; category defaults are too rough (they would
 * close every breakfast restaurant), so they never drop or swap a stop. A stop listed as closed on
 * arrival is swapped for the open unused candidate of the same type within SWAP_KM with the highest
 * rank − km away, or dropped when there is none.
 * A leg is dark when the sun is below civil twilight at its midpoint, at its middle minute.
 */
import { getTimes } from "suncalc";
import type { HoursEvaluator, OpenState } from "../city/openingHours.js";
import { haversineMeters, interpolate, type LngLat } from "../geo/geometry.js";
import { isDark } from "../safety/daylight.js";
import type { Candidate } from "./candidates.js";
import type { Pick } from "./prompt.js";
import { SLOTS, type BackBy, type Slot, type TripRequest } from "./trip.js";

export interface ScheduledStop extends Pick {
  readonly arriveAt: Date;
  readonly leaveAt: Date;
  readonly closesAt?: Date;
}

export interface Leg {
  readonly from: LngLat;
  readonly to: LngLat;
  readonly departAt: Date;
  readonly arriveAt: Date;
  readonly distanceMeters: number;
  readonly dark: boolean;
}

export interface ScheduledDay {
  readonly index: number;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly dusk: Date;
  readonly stops: readonly ScheduledStop[];
  /** legs[i] arrives at stops[i]; the extra last leg rides home. Empty when nothing fits. */
  readonly legs: readonly Leg[];
}

export interface ScheduleContext {
  readonly trip: TripRequest;
  readonly startAt: Date;
  readonly days: number;
  readonly utcOffsetMinutes: number;
  readonly hours: HoursEvaluator;
  readonly candidates: readonly Candidate[];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DAY_START = 8 * 60 + 30;
const PLAN_TODAY_BEFORE = 7 * 60 + 30;
const TYPICAL_DUSK = 18 * 60 + 30;
const HALF_DAY_HOURS = 5.5;
const ROAD_FACTOR = 1.35;
const RIDE_KMH = 18;
const PARKING_MINUTES = 4;
const SWAP_KM = 3;
const BACK_BY_MINUTES: Record<Exclude<BackBy, "sunset">, number> = { "20:00": 20 * 60, "22:00": 22 * 60 };
const MEAL_FROM: Partial<Record<Slot, number>> = { lunch: 12 * 60, snack: 16 * 60, dinner: 19 * 60 + 30 };
const DEFAULT_STAY_MINUTES = 60;
const STAY_MINUTES: Partial<Record<Candidate["kind"] | Slot, number>> = {
  breakfast: 40,
  lunch: 60,
  snack: 30,
  dinner: 60,
  heritage: 75,
  museum: 90,
  worship: 40,
  nature: 60,
  market: 50,
  attraction: 45,
};

const localMidnight = (at: Date, offset: number) => {
  const local = new Date(at.getTime() + offset * MINUTE);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset * MINUTE);
};
const minuteOfDay = (at: Date, offset: number) => (at.getTime() - localMidnight(at, offset).getTime()) / MINUTE;
const ceilToFive = (at: Date) => new Date(Math.ceil(at.getTime() / (5 * MINUTE)) * 5 * MINUTE);
const roadMeters = (a: LngLat, b: LngLat) => haversineMeters(a, b) * ROAD_FACTOR;
const rideMinutes = (a: LngLat, b: LngLat) => roadMeters(a, b) / ((RIDE_KMH * 1000) / 60) + PARKING_MINUTES;

/** 08:30 city time today if it is still early, otherwise tomorrow. */
export function tripStart(now: Date, utcOffsetMinutes: number): Date {
  const midnight = localMidnight(now, utcOffsetMinutes).getTime();
  const day = minuteOfDay(now, utcOffsetMinutes) < PLAN_TODAY_BEFORE ? midnight : midnight + DAY;
  return new Date(day + DAY_START * MINUTE);
}

function legBetween(from: LngLat, to: LngLat, departAt: Date, arriveAt: Date): Leg {
  const middle = new Date((departAt.getTime() + arriveAt.getTime()) / 2);
  return { from, to, departAt, arriveAt, distanceMeters: Math.round(roadMeters(from, to)), dark: isDark(interpolate(from, to, 0.5), middle) };
}

export function scheduleTrip(picks: readonly Pick[], ctx: ScheduleContext): ScheduledDay[] {
  const { trip, utcOffsetMinutes: offset, hours } = ctx;
  const base = trip.base.point;
  const used = new Set(picks.map((p) => p.candidate.ref));
  const slotOrder = (p: Pick) => SLOTS.indexOf(p.slot);

  const arrival = (from: LngLat, candidate: Candidate, slot: Slot, leaving: Date, midnight: number) => {
    const ridden = ceilToFive(new Date(leaving.getTime() + rideMinutes(from, candidate.point) * MINUTE));
    const mealFrom = MEAL_FROM[slot];
    return mealFrom !== undefined && ridden.getTime() < midnight + mealFrom * MINUTE ? new Date(midnight + mealFrom * MINUTE) : ridden;
  };
  const listedClosed = (state: OpenState) => !state.open && !state.estimated;

  return Array.from({ length: ctx.days }, (_, index): ScheduledDay => {
    const midnight = localMidnight(ctx.startAt, offset).getTime() + index * DAY;
    const startAt = new Date(midnight + DAY_START * MINUTE);
    const dusk = getTimes(new Date(midnight + 12 * 60 * MINUTE), base[1], base[0]).dusk ?? new Date(midnight + TYPICAL_DUSK * MINUTE);
    const backBy = trip.backBy === "sunset" ? dusk : new Date(midnight + BACK_BY_MINUTES[trip.backBy] * MINUTE);
    const endAt = trip.days === 0.5 ? new Date(Math.min(backBy.getTime(), startAt.getTime() + HALF_DAY_HOURS * 60 * MINUTE)) : backBy;

    const stops: ScheduledStop[] = [];
    const legs: Leg[] = [];
    let here = base;
    let free = startAt;

    for (const pick of picks.filter((p) => p.day === index).sort((a, b) => slotOrder(a) - slotOrder(b))) {
      let chosen: Pick = pick;
      let arriveAt = arrival(here, pick.candidate, pick.slot, free, midnight);
      let state = hours.stateAt(pick.candidate.hours, arriveAt);
      if (listedClosed(state)) {
        const swap = ctx.candidates
          .map((c) => ({ c, km: haversineMeters(here, c.point) / 1000 }))
          .filter(({ c, km }) => !used.has(c.ref) && c.type === pick.candidate.type && km <= SWAP_KM)
          .map(({ c, km }) => ({ c, score: c.rank - km, at: arrival(here, c, pick.slot, free, midnight) }))
          .filter(({ c, at }) => hours.stateAt(c.hours, at).open)
          .sort((a, b) => b.score - a.score)[0];
        if (!swap) continue;
        used.add(swap.c.ref);
        chosen = { day: pick.day, slot: pick.slot, candidate: swap.c };
        arriveAt = swap.at;
        state = hours.stateAt(swap.c.hours, arriveAt);
      }

      const stay = STAY_MINUTES[chosen.candidate.type === "see" ? chosen.candidate.kind : chosen.slot] ?? DEFAULT_STAY_MINUTES;
      const leaveAt = new Date(arriveAt.getTime() + stay * MINUTE);
      const home = ceilToFive(new Date(leaveAt.getTime() + rideMinutes(chosen.candidate.point, base) * MINUTE));
      if (home > endAt) continue;

      const departAt = new Date(arriveAt.getTime() - Math.ceil(rideMinutes(here, chosen.candidate.point)) * MINUTE);
      legs.push(legBetween(here, chosen.candidate.point, departAt < free ? free : departAt, arriveAt));
      stops.push({ ...chosen, arriveAt, leaveAt, ...(state.open && !state.estimated && state.closesAt ? { closesAt: state.closesAt } : {}) });
      here = chosen.candidate.point;
      free = leaveAt;
    }

    if (stops.length > 0) legs.push(legBetween(here, base, free, ceilToFive(new Date(free.getTime() + rideMinutes(here, base) * MINUTE))));
    return { index, startAt, endAt, dusk, stops, legs };
  });
}
