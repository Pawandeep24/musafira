/**
 * Ranks washrooms near a rider for "washrooms near me".
 *
 * Candidates: listed Safe Stops with at least one washroom, OSM public toilets, and fuel
 * stations (oil-company dealer rules require a clean, lit toilet with a door latch open to
 * customers and travellers; whether it has a women's section isn't recorded). Places
 * closed right now, marked men-only, or further than 4 km are left out.
 *
 * Order by an effective ride time in minutes, lowest first:
 *   cost = rideMinutes                          distance × 1.3 detour at 20 km/h, at least 1
 *        + 4 when women's access isn't recorded  worth riding ~4 min more for a known one
 *        + 2 when the hours are only typical     not declared by the place
 *        − 3 for a listed Safe Stop              staffed, promised, owner verified
 *        − 1 each for a woman attendant, a lock inside and pads on hand
 * Ties go to the nearer place. Every fact is returned so the client can filter without
 * another request.
 */
import type { Poi, Washroom } from "#src/city/cityData.js";
import type { HoursSubject, OpenState } from "#src/city/openingHours.js";
import { haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { osmHours, type SafeStop } from "#src/stops/safeStop.js";

const RADIUS_METERS = 4000;
const DETOUR = 1.3;
const METERS_PER_MINUTE = 20_000 / 60;
const UNKNOWN_WOMEN_MINUTES = 4;
const TYPICAL_HOURS_MINUTES = 2;
const SAFE_STOP_BONUS_MINUTES = 3;
const MAX_RESULTS = 25;

export type WashroomSource = "safeStop" | "public" | "fuel";

export interface WashroomFacts {
  readonly women?: boolean;
  readonly free?: boolean;
  readonly pads?: boolean;
  readonly attendant?: boolean;
  readonly lockInside?: boolean;
  readonly wheelchair?: boolean;
  readonly babyChanging?: boolean;
}

export interface WashroomCandidate {
  readonly id: string;
  readonly source: WashroomSource;
  readonly name?: string;
  readonly point: LngLat;
  readonly hours: HoursSubject;
  readonly facts: WashroomFacts;
  readonly safeStopId?: string;
}

export interface RankedWashroom extends Omit<WashroomCandidate, "hours"> {
  readonly distanceMeters: number;
  readonly rideMinutes: number;
  readonly estimated: boolean;
  readonly closesAt?: Date;
}

export const publicWashroom = (w: Washroom): WashroomCandidate => ({
  id: `osm:${w.id}`,
  source: "public",
  ...(w.name ? { name: w.name } : {}),
  point: [w.lon, w.lat],
  hours: { cat: "washroom", ...(w.hours ? { hours: w.hours } : {}) },
  facts: { women: w.women, free: w.free, pads: w.pads, wheelchair: w.wheelchair, babyChanging: w.babyChanging },
});

export const fuelStation = (poi: Poi): WashroomCandidate => ({
  id: `fuel:${poi.id}`,
  source: "fuel",
  ...(poi.name ? { name: poi.name } : {}),
  point: [poi.lon, poi.lat],
  hours: { cat: "fuel", ...(poi.hours ? { hours: poi.hours } : {}) },
  facts: {},
});

export function safeStopWashroom({ id, profile }: SafeStop): WashroomCandidate | undefined {
  const { washrooms, features } = profile;
  if (washrooms.total === 0) return undefined;
  return {
    id: `stop:${id}`,
    source: "safeStop",
    name: profile.name,
    point: profile.point,
    hours: { cat: "safe_stop", hours: osmHours(profile.hours) },
    facts: {
      women: washrooms.women + washrooms.unisex > 0,
      free: profile.access === "anyone",
      pads: profile.pads !== "none",
      attendant: profile.attendant !== "none",
      lockInside: features.includes("lock_inside"),
      wheelchair: washrooms.accessible > 0,
      babyChanging: features.includes("baby_changing"),
    },
    safeStopId: id,
  };
}

const cost = (washroom: RankedWashroom) =>
  washroom.rideMinutes +
  (washroom.facts.women === undefined ? UNKNOWN_WOMEN_MINUTES : 0) +
  (washroom.estimated ? TYPICAL_HOURS_MINUTES : 0) -
  (washroom.source === "safeStop" ? SAFE_STOP_BONUS_MINUTES : 0) -
  [washroom.facts.attendant, washroom.facts.lockInside, washroom.facts.pads].filter(Boolean).length;

export function rankWashrooms(
  from: LngLat,
  at: Date,
  candidates: readonly WashroomCandidate[],
  stateAt: (place: HoursSubject, at: Date) => OpenState,
): RankedWashroom[] {
  const ranked = candidates.flatMap(({ hours, ...candidate }): RankedWashroom[] => {
    if (candidate.facts.women === false) return [];
    const distanceMeters = haversineMeters(from, candidate.point);
    if (distanceMeters > RADIUS_METERS) return [];
    const state = stateAt(hours, at);
    if (!state.open) return [];
    return [
      {
        ...candidate,
        distanceMeters,
        rideMinutes: Math.max(1, Math.ceil((distanceMeters * DETOUR) / METERS_PER_MINUTE)),
        estimated: state.estimated,
        ...(state.closesAt ? { closesAt: state.closesAt } : {}),
      },
    ];
  });
  return ranked.sort((a, b) => cost(a) - cost(b) || a.distanceMeters - b.distanceMeters).slice(0, MAX_RESULTS);
}

export const WASHROOM_SEARCH_METERS = RADIUS_METERS;
