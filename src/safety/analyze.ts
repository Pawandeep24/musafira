import type { Poi } from "../city/cityData.js";
import type { CityIndex, NearbyPoi } from "../city/cityIndex.js";
import type { HoursEvaluator } from "../city/openingHours.js";
import { haversineMeters, type LngLat } from "../geo/geometry.js";
import { applyReports, type CommunityReport } from "./community.js";
import { isDark } from "./daylight.js";
import { FEATURE_EXTRACTORS } from "./features/index.js";
import { PARAMETER_IDS, type ParameterId } from "./parameters.js";
import { segmentRoute } from "./segmentation.js";
import { findRouteStops } from "./stops.js";
import type { CandidateRoute, FeatureResult, RouteAnalysis, RouteContext, SegmentContext, TrafficSample } from "./types.js";

const SEGMENT_METERS = 100;
const NEARBY_RADIUS_METERS = 300;

export interface AnalyzeInput {
  readonly route: CandidateRoute;
  readonly departAt: Date;
  readonly city: CityIndex;
  readonly hours: HoursEvaluator;
  readonly traffic: readonly TrafficSample[];
  readonly reports?: readonly CommunityReport[];
  /** Places not in the city data, such as listed Safe Stops. */
  readonly extraPois?: readonly Poi[];
}

function extraWithin(pois: readonly Poi[], point: LngLat, radiusMeters: number): NearbyPoi[] {
  return pois.flatMap((poi) => {
    const distanceMeters = haversineMeters(point, [poi.lon, poi.lat]);
    return distanceMeters <= radiusMeters ? [{ poi, distanceMeters }] : [];
  });
}

/** Measures every safety parameter along a route. Pure: same input, same output. */
export function analyzeRoute({ route, departAt, city, hours, traffic, reports = [], extraPois = [] }: AnalyzeInput): RouteAnalysis {
  const segments: SegmentContext[] = segmentRoute(route, departAt, SEGMENT_METERS).map((segment) => ({
    ...segment,
    dark: isDark(segment.midpoint, segment.arrival),
    nearby: [...city.poisWithin(segment.midpoint, NEARBY_RADIUS_METERS), ...extraWithin(extraPois, segment.midpoint, NEARBY_RADIUS_METERS)],
  }));
  const stateAt: HoursEvaluator["stateAt"] = (poi, at) => hours.stateAt(poi, at);
  const stops = findRouteStops(segments, stateAt);

  const context: RouteContext = {
    segments,
    stops,
    traffic,
    radianceAt: (point) => city.radianceAt(point),
    cellDensityAt: (point) => city.cellDensityAt(point),
    isOpen: stateAt,
  };

  const results = Object.fromEntries(
    PARAMETER_IDS.map((id) => [id, FEATURE_EXTRACTORS[id].measure(context)]),
  ) as Record<ParameterId, FeatureResult>;
  const community = applyReports(segments, mapRecord(results, (r) => r.values), reports, city.data.utcOffsetMinutes);

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    departAt,
    arriveAt: new Date(departAt.getTime() + route.durationSeconds * 1000),
    segments: segments.map(({ nearby: _nearby, ...segment }) => segment),
    measurements: community.measurements,
    quality: mapRecord(results, (r) => r.quality),
    stops,
    reportedStretches: community.reportedStretches,
    reports: community.reports,
    reportIds: community.reportIds,
    roadClosed: traffic.some((t) => t.roadClosure),
    liveTraffic: traffic.length > 0,
  };
}

function mapRecord<T, U>(record: Record<ParameterId, T>, fn: (value: T) => U): Record<ParameterId, U> {
  return Object.fromEntries(PARAMETER_IDS.map((id) => [id, fn(record[id])])) as Record<ParameterId, U>;
}
