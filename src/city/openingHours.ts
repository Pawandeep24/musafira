/**
 * Decides whether a place is open at a given instant.
 *
 * Two sources, in order:
 * 1. The OSM `opening_hours` tag, evaluated with the `opening_hours` library.
 * 2. A per-category default table (POI categories, sight kinds and public
 *    washrooms), flagged `estimated: true` so the UI and the confidence score can
 *    say so. Most Indian POIs have no hours tag. Safe Stops always declare their
 *    hours, so their default is "closed" rather than a guess.
 *
 * Time zones: the `opening_hours` library reads a Date's *local* fields, which
 * depend on the server's zone. We hand it a "wall clock" Date whose local fields
 * equal the city's local time, then convert results back to real instants.
 */
import OpeningHours from "opening_hours";
import type { LngLat } from "../geo/geometry.js";
import type { PoiCategory, SightKind } from "./cityData.js";

type HoursCategory = PoiCategory | SightKind | "washroom";

export interface HoursSubject {
  readonly cat: HoursCategory;
  readonly hours?: string;
}

export interface OpenState {
  readonly open: boolean;
  readonly estimated: boolean;
  readonly closesAt?: Date;
}

type Interval = readonly [startMinute: number, endMinute: number];

const MINUTES_PER_DAY = 24 * 60;
const ALWAYS: readonly Interval[] = [[0, MINUTES_PER_DAY]];
const hm = (h: number, m = 0) => h * 60 + m;

/** Conservative typical hours for Indian cities; end minutes past 1440 run into the next day. */
const DEFAULT_HOURS: Record<HoursCategory, readonly Interval[]> = {
  police: ALWAYS,
  hospital: ALWAYS,
  hotel: ALWAYS,
  fuel: [[hm(6), hm(23)]],
  pharmacy: [[hm(9), hm(22, 30)]],
  clinic: [[hm(9), hm(21)]],
  doctors: [
    [hm(10), hm(13, 30)],
    [hm(17), hm(21)],
  ],
  convenience: [[hm(7, 30), hm(23)]],
  supermarket: [[hm(9), hm(22)]],
  shop: [[hm(10), hm(21, 30)]],
  restaurant: [[hm(11, 30), hm(23)]],
  cafe: [[hm(8), hm(23)]],
  fast_food: [[hm(11), hm(24, 30)]],
  bike_repair: [[hm(9, 30), hm(20, 30)]],
  bus_stop: [[hm(6), hm(23)]],
  transit_station: [[hm(6), hm(23)]],
  safe_stop: [],
  washroom: [[hm(6), hm(22)]],
  heritage: [[hm(9), hm(17, 30)]],
  museum: [[hm(10), hm(17)]],
  worship: [
    [hm(6), hm(12, 30)],
    [hm(16), hm(21)],
  ],
  nature: [[hm(6), hm(18, 30)]],
  market: [[hm(8), hm(21)]],
  attraction: [[hm(9), hm(18)]],
};

function defaultState(category: HoursCategory, at: Date, utcOffsetMinutes: number): OpenState {
  const local = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const [start, end] of DEFAULT_HOURS[category]) {
    if (end - start >= MINUTES_PER_DAY) return { open: true, estimated: true };
    const position = minute >= start && minute < end ? minute : minute + MINUTES_PER_DAY < end ? minute + MINUTES_PER_DAY : null;
    if (position !== null) {
      return { open: true, estimated: true, closesAt: new Date(at.getTime() + (end - position) * 60_000) };
    }
  }
  return { open: false, estimated: true };
}

export interface HoursEvaluator {
  stateAt(place: HoursSubject, at: Date): OpenState;
}

export function createHoursEvaluator(center: LngLat, utcOffsetMinutes: number): HoursEvaluator {
  const parsed = new Map<string, OpeningHours | null>();
  const locale = { lat: center[1], lon: center[0], address: { country_code: "in", state: "" } };

  const parse = (value: string): OpeningHours | null => {
    if (!parsed.has(value)) {
      try {
        parsed.set(value, new OpeningHours(value, locale));
      } catch {
        parsed.set(value, null);
      }
    }
    return parsed.get(value) ?? null;
  };

  const toWallClock = (instant: Date) =>
    new Date(instant.getTime() + (utcOffsetMinutes + instant.getTimezoneOffset()) * 60_000);
  const fromWallClock = (wall: Date) =>
    new Date(wall.getTime() - (utcOffsetMinutes + wall.getTimezoneOffset()) * 60_000);

  return {
    stateAt(place, at) {
      const hours = place.hours ? parse(place.hours) : null;
      if (!hours) return defaultState(place.cat, at, utcOffsetMinutes);
      const wall = toWallClock(at);
      if (hours.getUnknown(wall)) return defaultState(place.cat, at, utcOffsetMinutes);
      const open = hours.getState(wall);
      const change = open ? hours.getNextChange(wall) : undefined;
      return { open, estimated: false, ...(change ? { closesAt: fromWallClock(change) } : {}) };
    },
  };
}
