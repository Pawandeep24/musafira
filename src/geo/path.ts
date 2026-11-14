import { haversineMeters, interpolate, type LngLat } from "./geometry.js";

export interface PathPosition {
  /** Index of the vertex at or before the position. */
  readonly index: number;
  /** Fraction 0..1 of the way from `index` to `index + 1`. */
  readonly t: number;
}

export interface MeasuredPath {
  readonly points: readonly LngLat[];
  readonly cumulative: readonly number[];
  readonly totalMeters: number;
  locate(meters: number): PathPosition;
  pointAt(meters: number): LngLat;
}

export function measurePath(points: readonly LngLat[]): MeasuredPath {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1]! + haversineMeters(points[i - 1]!, points[i]!));
  const totalMeters = cumulative[cumulative.length - 1]!;
  const lastStart = Math.max(0, points.length - 2);

  const locate = (meters: number): PathPosition => {
    let low = 0;
    let high = lastStart;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (cumulative[mid]! <= meters) low = mid;
      else high = mid - 1;
    }
    const span = (cumulative[low + 1] ?? cumulative[low]!) - cumulative[low]!;
    return { index: low, t: span > 0 ? Math.min(1, Math.max(0, (meters - cumulative[low]!) / span)) : 0 };
  };

  return {
    points,
    cumulative,
    totalMeters,
    locate,
    pointAt(meters) {
      const { index, t } = locate(meters);
      return interpolate(points[index]!, points[index + 1] ?? points[index]!, t);
    },
  };
}

/** Evenly spaced positions along a path, starting half a spacing in, capped at `max`. */
export function samplePositions(totalMeters: number, spacingMeters: number, max: number): number[] {
  const count = Math.min(max, Math.max(1, Math.round(totalMeters / spacingMeters)));
  const step = totalMeters / count;
  return Array.from({ length: count }, (_, i) => step * (i + 0.5));
}
