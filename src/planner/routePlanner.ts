/**
 * Application service behind the route endpoints. Orchestrates IO around the pure
 * safety engine:
 *
 *   plan()    → city lookup → route candidates (cached 10 min) → live traffic when
 *               leaving within 15 min → analyseRoute per candidate with the city's
 *               rider reports → store analyses under a random searchId (30 min,
 *               memory only) → score with weights
 *             Rider reports within 1 km of any candidate are returned for the map,
 *             each tagged with the routes it affected.
 *   rescore() → re-weights a stored search without any network call
 *
 * Stored searches hold route geometry, so they never leave process memory and are
 * not logged. Traffic is snapshotted at plan time, which keeps rescoring deterministic.
 */
import { randomUUID } from "node:crypto";
import type { CityIndex } from "../city/cityIndex.js";
import type { CityRegistry } from "../city/cityRegistry.js";
import { createHoursEvaluator, type HoursEvaluator } from "../city/openingHours.js";
import { bboxAround, type LngLat } from "../geo/geometry.js";
import { measurePath, samplePositions } from "../geo/path.js";
import { AppError } from "../lib/errors.js";
import { TtlCache } from "../lib/ttlCache.js";
import { analyzeRoute } from "../safety/analyze.js";
import { spotsWithin, type SpotReport } from "../safety/community.js";
import type { ScoringOptions, Weights } from "../safety/parameters.js";
import { scoreRoute } from "../safety/scoring.js";
import type { CandidateRoute, RouteAnalysis, RouteScore, TrafficSample } from "../safety/types.js";
import type { ReportSource, RouteProvider, TrafficProvider, TrafficReading } from "./ports.js";

const LIVE_WINDOW_MS = 15 * 60_000;
const TRAFFIC_SPACING_METERS = 2000;
const TRAFFIC_SAMPLES_PER_ROUTE = 6;
const TRAFFIC_CONCURRENCY = 4;
const REPORT_AREA_PADDING_METERS = 1000;

export type RouteLabel = "safest" | "fastest";

export interface TripReport extends SpotReport {
  readonly routeIds: readonly string[];
}

const routeId = (index: number) => `r${index}`;

export interface RankedRoute {
  readonly id: string;
  readonly labels: readonly RouteLabel[];
  readonly analysis: RouteAnalysis;
  readonly result: RouteScore;
}

export interface PlanResult {
  readonly searchId: string;
  readonly city: CityIndex;
  readonly departAt: Date;
  readonly routes: readonly RankedRoute[];
  readonly reports: readonly TripReport[];
}

export interface PlanRequest {
  readonly from: LngLat;
  readonly to: LngLat;
  readonly departAt?: Date;
  readonly weights: Weights;
  readonly options: ScoringOptions;
}

export interface RoutePlanner {
  plan(request: PlanRequest): Promise<PlanResult>;
  rescore(searchId: string, weights: Weights, options: ScoringOptions): PlanResult;
}

export interface PlannerDeps {
  readonly cities: CityRegistry;
  readonly routing: RouteProvider;
  readonly traffic?: TrafficProvider;
  readonly reports?: ReportSource;
  readonly now?: () => Date;
}

interface StoredSearch {
  readonly city: CityIndex;
  readonly departAt: Date;
  readonly analyses: readonly RouteAnalysis[];
  readonly reports: readonly TripReport[];
}

async function mapWithLimit<T, U>(items: readonly T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function rankRoutes(analyses: readonly RouteAnalysis[], weights: Weights, options: ScoringOptions): RankedRoute[] {
  const scored = analyses.map((analysis, i) => ({ id: routeId(i), analysis, result: scoreRoute(analysis, weights, options) }));
  const fastest = Math.min(...scored.map((r) => r.analysis.durationSeconds));
  return scored
    .sort((a, b) => b.result.score - a.result.score || a.analysis.durationSeconds - b.analysis.durationSeconds)
    .map((route, rank) => ({
      ...route,
      labels: [
        ...(rank === 0 ? (["safest"] as const) : []),
        ...(route.analysis.durationSeconds === fastest ? (["fastest"] as const) : []),
      ],
    }));
}

export function createRoutePlanner({ cities, routing, traffic, reports, now = () => new Date() }: PlannerDeps): RoutePlanner {
  const candidatesCache = new TtlCache<string, Promise<CandidateRoute[]>>(10 * 60_000, 200);
  const trafficCache = new TtlCache<string, Promise<TrafficReading | undefined>>(2 * 60_000, 2000);
  const searches = new TtlCache<string, StoredSearch>(30 * 60_000, 500);
  const hoursByCity = new Map<string, HoursEvaluator>(
    cities.cities.map((c) => [c.id, createHoursEvaluator(c.data.center, c.data.utcOffsetMinutes)]),
  );

  const candidatesFor = (from: LngLat, to: LngLat) => {
    const key = [...from, ...to].map((v) => v.toFixed(5)).join(",");
    const cached = candidatesCache.get(key);
    if (cached) return cached;
    const pending = routing.routes(from, to);
    candidatesCache.set(key, pending);
    pending.catch(() => candidatesCache.delete(key));
    return pending;
  };

  const sampleTraffic = async (route: CandidateRoute): Promise<TrafficSample[]> => {
    if (!traffic) return [];
    const path = measurePath(route.shape);
    const positions = samplePositions(path.totalMeters, TRAFFIC_SPACING_METERS, TRAFFIC_SAMPLES_PER_ROUTE);
    const samples = await mapWithLimit(positions, TRAFFIC_CONCURRENCY, async (alongMeters) => {
      const point = path.pointAt(alongMeters);
      const key = point.map((v) => v.toFixed(3)).join(",");
      let reading = trafficCache.get(key);
      if (!reading) {
        reading = traffic.flowAt(point).catch(() => undefined);
        trafficCache.set(key, reading);
      }
      const value = await reading;
      return value ? { ...value, alongMeters } : undefined;
    });
    return samples.filter((s): s is TrafficSample => s !== undefined);
  };

  return {
    async plan({ from, to, departAt: requested, weights, options }) {
      const city = cities.locate(from);
      if (!city || !city.contains(to)) {
        const names = cities.cities.map((c) => c.data.name).join(" and ");
        throw new AppError(422, "OUTSIDE_COVERAGE", `Both points must be inside one covered city (${names || "none loaded"})`);
      }
      const clock = now();
      const departAt = requested ?? clock;
      const live = Math.abs(departAt.getTime() - clock.getTime()) <= LIVE_WINDOW_MS;

      const candidates = await candidatesFor(from, to);
      const hours = hoursByCity.get(city.id)!;
      const cityReports = reports?.active(city.id) ?? [];
      const analyses = await Promise.all(
        candidates.map(async (route) =>
          analyzeRoute({ route, departAt, city, hours, traffic: live ? await sampleTraffic(route) : [], reports: cityReports }),
        ),
      );

      const area = bboxAround(candidates.flatMap((c) => c.shape), REPORT_AREA_PADDING_METERS);
      const tripReports = spotsWithin(cityReports, area).map((spot) => ({
        ...spot,
        routeIds: analyses.flatMap((a, i) => (a.reportIds.some((id) => spot.reportIds.includes(id)) ? [routeId(i)] : [])),
      }));

      const searchId = randomUUID();
      searches.set(searchId, { city, departAt, analyses, reports: tripReports });
      return { searchId, city, departAt, routes: rankRoutes(analyses, weights, options), reports: tripReports };
    },

    rescore(searchId, weights, options) {
      const search = searches.get(searchId);
      if (!search) throw new AppError(404, "SEARCH_EXPIRED", "This search has expired. Plan the route again.");
      const { city, departAt, analyses, reports: tripReports } = search;
      return { searchId, city, departAt, routes: rankRoutes(analyses, weights, options), reports: tripReports };
    },
  };
}
