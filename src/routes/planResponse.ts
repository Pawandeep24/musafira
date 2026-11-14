import type { LngLat } from "../geo/geometry.js";
import { PARAMETER_IDS, type ParameterId } from "../safety/parameters.js";
import type { Segment, Stretch } from "../safety/types.js";
import type { PlanResult, RankedRoute } from "../planner/routePlanner.js";

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const roundPoint = ([lon, lat]: LngLat): LngLat => [round(lon, 6), round(lat, 6)];

function pathOf(segments: readonly Segment[], stretch: Stretch): LngLat[] {
  return segments
    .filter((s) => s.startMeters >= stretch.startMeters && s.endMeters <= stretch.endMeters)
    .flatMap((s, i) => (i === 0 ? s.path : s.path.slice(1)))
    .map(roundPoint);
}

function toRoute({ id, labels, analysis, result }: RankedRoute) {
  const stretch = (s: Stretch) => ({ ...s, path: pathOf(analysis.segments, s) });
  return {
    id,
    labels,
    score: result.score,
    confidence: result.confidence,
    distanceMeters: Math.round(analysis.distanceMeters),
    durationSeconds: Math.round(analysis.durationSeconds),
    departAt: analysis.departAt.toISOString(),
    arriveAt: analysis.arriveAt.toISOString(),
    liveTraffic: analysis.liveTraffic,
    roadClosed: analysis.roadClosed,
    breakdown: result.breakdown,
    penalties: result.penalties,
    longestStopGapMeters: result.longestStopGapMeters,
    darkStretches: result.darkStretches.map(stretch),
    deadZones: result.deadZones.map(stretch),
    segments: analysis.segments.map((segment, i) => ({
      startMeters: Math.round(segment.startMeters),
      endMeters: Math.round(segment.endMeters),
      path: segment.path.map(roundPoint),
      arrival: segment.arrival.toISOString(),
      dark: segment.dark,
      score: result.segmentScores[i] ?? null,
      values: Object.fromEntries(
        PARAMETER_IDS.map((p) => {
          const value = analysis.measurements[p][i];
          return [p, typeof value === "number" ? round(value, 2) : null];
        }),
      ) as Record<ParameterId, number | null>,
    })),
    stops: analysis.stops.map((stop) => ({
      ...stop,
      point: roundPoint(stop.point),
      alongMeters: Math.round(stop.alongMeters),
      arrival: stop.arrival.toISOString(),
      closesAt: stop.closesAt?.toISOString() ?? null,
    })),
    reports: analysis.reports.map((report) => ({ ...report, lastObservedAt: report.lastObservedAt.toISOString() })),
  };
}

export function toPlanResponse(plan: PlanResult) {
  return {
    searchId: plan.searchId,
    city: { id: plan.city.id, name: plan.city.data.name, dataVersion: plan.city.data.version },
    departAt: plan.departAt.toISOString(),
    routes: plan.routes.map(toRoute),
    reports: plan.reports.map(({ category, point, count, lastObservedAt, routeIds }) => ({
      category,
      point: [round(point[0], 4), round(point[1], 4)],
      count,
      lastObservedAt: lastObservedAt.toISOString(),
      routeIds,
    })),
  };
}
