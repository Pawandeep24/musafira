import type { LngLat } from "../geo/geometry.js";
import { measurePath } from "../geo/path.js";
import type { CandidateRoute, RoadSpan } from "./types.js";

export interface RawSegment {
  readonly index: number;
  readonly startMeters: number;
  readonly endMeters: number;
  readonly path: readonly LngLat[];
  readonly midpoint: LngLat;
  readonly arrival: Date;
  readonly roadClass?: string;
  readonly tunnel: boolean;
}

/** A trailing piece shorter than this merges into the previous segment. */
const MIN_TAIL_METERS = 30;

function boundaries(total: number, segmentMeters: number): number[] {
  const cuts = [0];
  for (let m = segmentMeters; m < total; m += segmentMeters) cuts.push(m);
  if (cuts.length > 1 && total - cuts[cuts.length - 1]! < MIN_TAIL_METERS) cuts.pop();
  cuts.push(total);
  return cuts;
}

const roadAt = (roads: readonly RoadSpan[], meters: number) => roads.find((span) => span.endMeters >= meters);

/** Splits a route into fixed-length pieces, each with its own geometry, ETA and road class. */
export function segmentRoute(route: CandidateRoute, departAt: Date, segmentMeters: number): RawSegment[] {
  if (route.shape.length < 2) return [];
  const path = measurePath(route.shape);
  if (path.totalMeters <= 0) return [];

  const secondsAtMeters = (meters: number): number => {
    const { index, t } = path.locate(meters);
    const from = route.secondsAt[index]!;
    return from + ((route.secondsAt[index + 1] ?? from) - from) * t;
  };
  const toRouteMeters = route.distanceMeters / path.totalMeters;

  const cuts = boundaries(path.totalMeters, segmentMeters);
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]!;
    const inner = route.shape.filter((_, v) => path.cumulative[v]! > start && path.cumulative[v]! < end);
    const mid = (start + end) / 2;
    const road = roadAt(route.roads, mid * toRouteMeters);
    return {
      index,
      startMeters: start,
      endMeters: end,
      path: [path.pointAt(start), ...inner, path.pointAt(end)],
      midpoint: path.pointAt(mid),
      arrival: new Date(departAt.getTime() + secondsAtMeters(mid) * 1000),
      ...(road ? { roadClass: road.roadClass } : {}),
      tunnel: road?.tunnel ?? false,
    };
  });
}
