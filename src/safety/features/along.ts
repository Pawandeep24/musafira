import type { RouteStop, Segment, StopKind } from "../types.js";

export const midMeters = (segment: Segment) => (segment.startMeters + segment.endMeters) / 2;

/** Along-route distance to the closest position, or Infinity when there are none. */
export function nearestAlong(positions: readonly number[], meters: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const position of positions) best = Math.min(best, Math.abs(position - meters));
  return best;
}

export function openStopPositions(stops: readonly RouteStop[], kind: StopKind): number[] {
  return stops.filter((s) => s.kinds.includes(kind) && s.open).map((s) => s.alongMeters);
}

/** Share of stops of a kind whose hours came from real data rather than category defaults. */
export function hoursQuality(stops: readonly RouteStop[], kind: StopKind): number {
  const ofKind = stops.filter((s) => s.kinds.includes(kind));
  if (ofKind.length === 0) return 0.6;
  return 0.6 + (0.4 * ofKind.filter((s) => !s.estimated).length) / ofKind.length;
}
