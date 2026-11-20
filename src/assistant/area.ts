/**
 * What one spot is like at one time, for the city assistant's area check. Every level reuses a curve
 * or threshold of the route score, so "dark" here means what a dark stretch means there.
 *
 *   light    daylight until civil dusk; after it saturate(radiance, 20) from NASA night lights:
 *            bright ≥ 0.8, lit ≥ 0.55, dim ≥ 0.35, dark below (the score's dark-stretch line)
 *   signal   saturate(cell IDs per km², 15): strong ≥ 0.75, fair ≥ 0.45, weak ≥ 0.25, none below
 *            (the score's dead-zone line)
 *   people   storefronts, fuel, stops, stations, hotels and hospitals open within 300 m:
 *            busy ≥ 12, some ≥ 4, quiet ≥ 1, otherwise deserted
 *   help     safety stops (police, hospitals, fuel, pharmacies, clinics, hotels, 24/7 shops and listed
 *            Safe Stops) open within 1 km, nearest first
 *   reports  rider reports within 500 m from the last 90 days, by category and band of the day
 *
 * Opening hours come from the same evaluator as routes: OSM where tagged, typical hours otherwise.
 */
import type { Poi } from "#src/city/cityData.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { HoursEvaluator } from "#src/city/openingHours.js";
import { haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { bandOf, type CommunityReport, type DayBand, type ReportCategory } from "#src/safety/community.js";
import { saturate } from "#src/safety/curves.js";
import { isDark } from "#src/safety/daylight.js";
import { ACTIVITY, SAFETY_STOPS } from "#src/safety/features/categories.js";
import { RADIANCE_K } from "#src/safety/features/lighting.js";
import { DENSITY_K } from "#src/safety/features/signal.js";
import { DARK_BELOW, DEAD_ZONE_BELOW } from "#src/safety/scoring.js";

const PEOPLE_METERS = 300;
const HELP_METERS = 1000;
const REPORT_METERS = 500;
const REPORT_MAX_DAYS = 90;
const MAX_HELP_POINTS = 5;
const DAY_MS = 86_400_000;

export type LightLevel = "daylight" | "bright" | "lit" | "dim" | "dark" | "unknown";
export type SignalLevel = "strong" | "fair" | "weak" | "none" | "unknown";
export type PeopleLevel = "busy" | "some" | "quiet" | "deserted";

export interface OpenPlace {
  readonly poi: Poi;
  readonly meters: number;
  readonly estimated: boolean;
  readonly closesAt?: Date;
}

export interface AreaReport {
  readonly category: ReportCategory;
  readonly band: DayBand;
  readonly count: number;
  readonly lastDaysAgo: number;
}

export interface AreaSnapshot {
  readonly light: LightLevel;
  readonly signal: SignalLevel;
  readonly people: PeopleLevel;
  readonly openPlaces: number;
  readonly help: readonly OpenPlace[];
  readonly reports: readonly AreaReport[];
}

export interface AreaInput {
  readonly city: CityIndex;
  readonly hours: HoursEvaluator;
  readonly reports: readonly CommunityReport[];
  readonly safeStops: readonly Poi[];
  readonly point: LngLat;
  readonly at: Date;
}

const level = <T extends string>(value: number, steps: readonly (readonly [number, T])[], below: T): T =>
  steps.find(([min]) => value >= min)?.[1] ?? below;

function lightAt(city: CityIndex, point: LngLat, at: Date): LightLevel {
  if (!isDark(point, at)) return "daylight";
  const radiance = city.radianceAt(point);
  if (radiance === undefined) return "unknown";
  return level(
    saturate(radiance, RADIANCE_K),
    [
      [0.8, "bright"],
      [0.55, "lit"],
      [DARK_BELOW, "dim"],
    ],
    "dark",
  );
}

function signalAt(city: CityIndex, point: LngLat): SignalLevel {
  const density = city.cellDensityAt(point);
  if (density === undefined) return "unknown";
  return level(
    saturate(density, DENSITY_K),
    [
      [0.75, "strong"],
      [0.45, "fair"],
      [DEAD_ZONE_BELOW, "weak"],
    ],
    "none",
  );
}

/** Places of the city, plus any extra POIs (listed Safe Stops), open at `at` within `meters`, nearest first. */
export function openPlacesNear(input: Omit<AreaInput, "reports">, meters: number): OpenPlace[] {
  const { city, hours, safeStops, point, at } = input;
  const candidates = [
    ...city.poisWithin(point, meters).map(({ poi, distanceMeters }) => ({ poi, meters: distanceMeters })),
    ...safeStops.flatMap((poi) => {
      const distance = haversineMeters(point, [poi.lon, poi.lat]);
      return distance <= meters ? [{ poi, meters: distance }] : [];
    }),
  ];
  return candidates
    .flatMap(({ poi, meters: distance }) => {
      const state = hours.stateAt(poi, at);
      return state.open ? [{ poi, meters: distance, estimated: state.estimated, ...(state.closesAt ? { closesAt: state.closesAt } : {}) }] : [];
    })
    .sort((a, b) => a.meters - b.meters);
}

function reportsNear(reports: readonly CommunityReport[], point: LngLat, at: Date, utcOffsetMinutes: number): AreaReport[] {
  const groups = new Map<string, AreaReport>();
  for (const report of reports) {
    const daysAgo = Math.max(0, (at.getTime() - report.observedAt.getTime()) / DAY_MS);
    if (daysAgo > REPORT_MAX_DAYS || haversineMeters(point, report.point) > REPORT_METERS) continue;
    const band = bandOf(report.observedAt, utcOffsetMinutes);
    const key = `${report.category}|${band}`;
    const group = groups.get(key);
    groups.set(key, {
      category: report.category,
      band,
      count: (group?.count ?? 0) + 1,
      lastDaysAgo: Math.round(Math.min(group?.lastDaysAgo ?? Infinity, daysAgo)),
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.lastDaysAgo - b.lastDaysAgo);
}

export function checkArea(input: AreaInput): AreaSnapshot {
  const { city, point, at } = input;
  const open = openPlacesNear(input, HELP_METERS);
  const openPlaces = open.filter((p) => p.meters <= PEOPLE_METERS && ACTIVITY.has(p.poi.cat)).length;
  return {
    light: lightAt(city, point, at),
    signal: signalAt(city, point),
    people: level(
      openPlaces,
      [
        [12, "busy"],
        [4, "some"],
        [1, "quiet"],
      ],
      "deserted",
    ),
    openPlaces,
    help: open.filter((p) => SAFETY_STOPS.has(p.poi.cat)).slice(0, MAX_HELP_POINTS),
    reports: reportsNear(input.reports, point, at, city.data.utcOffsetMinutes),
  };
}
