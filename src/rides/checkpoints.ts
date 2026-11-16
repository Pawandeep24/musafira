/**
 * Safety checkpoints: the fewest stops that make a car route follow Musafira's safe route.
 *
 * Ride-hailing apps route and price a ride through the stops they are given (Namma Yatri's
 * one-way search takes `stops`), so stops are how a rider agrees the route before pickup.
 *
 *   coverage = share of the safe route lying within ON_ROUTE_METERS of the car route,
 *              sampled every SAMPLE_METERS along the safe route
 *
 * Loop: route by car through the checkpoints so far; while coverage < TARGET_COVERAGE and
 * there are fewer than MAX_CHECKPOINTS, add one at the middle of the longest stretch of the
 * safe route the car route misses: the middle is a point a router can only reach by using that
 * stretch. Misses shorter than MIN_MISS_METERS (a parallel lane, a slip road) and the first and
 * last END_CLEARANCE_METERS (pickup and drop already pin those) are not worth a stop.
 * Checkpoints stay in safe-route order. A checkpoint that doesn't raise coverage, or that bends
 * the route past MAX_LENGTH_RATIO of the safe route's length (a loop around a one-way block),
 * ends the search and the best set so far is kept.
 */
import { distancesToPathMeters, type LngLat } from "#src/geo/geometry.js";
import { measurePath, type MeasuredPath } from "#src/geo/path.js";

export const ON_ROUTE_METERS = 40;
export const MAX_CHECKPOINTS = 3;
const SAMPLE_METERS = 25;
const TARGET_COVERAGE = 0.9;
const MIN_MISS_METERS = 150;
const END_CLEARANCE_METERS = 300;
const MAX_LENGTH_RATIO = 1.25;

export interface Checkpoint {
  readonly point: LngLat;
  readonly alongMeters: number;
}

export interface RoutedPath {
  readonly shape: readonly LngLat[];
  readonly distanceMeters: number;
}

export interface CheckpointPlan<R extends RoutedPath> {
  readonly checkpoints: readonly Checkpoint[];
  /** The car route through the checkpoints. */
  readonly route: R;
  readonly coverage: number;
  /** The car route with no checkpoints. */
  readonly direct: R;
  readonly directCoverage: number;
}

interface Stretch {
  readonly startMeters: number;
  readonly endMeters: number;
}

interface Measured {
  readonly coverage: number;
  readonly misses: readonly Stretch[];
}

/** Share of `safe` that `route` follows, and the stretches it misses. */
export function measureCoverage(safe: MeasuredPath, route: readonly LngLat[]): Measured {
  const count = Math.max(1, Math.round(safe.totalMeters / SAMPLE_METERS));
  const step = safe.totalMeters / count;
  const positions = Array.from({ length: count }, (_, i) => step * (i + 0.5));
  const covered = distancesToPathMeters(positions.map(safe.pointAt), route).map((d) => d <= ON_ROUTE_METERS);

  const misses: Stretch[] = [];
  let runStart: number | undefined;
  covered.forEach((on, i) => {
    if (!on && runStart === undefined) runStart = i;
    if ((on || i === count - 1) && runStart !== undefined) {
      const runEnd = on ? i - 1 : i;
      misses.push({ startMeters: positions[runStart]! - step / 2, endMeters: positions[runEnd]! + step / 2 });
      runStart = undefined;
    }
  });
  return { coverage: covered.filter(Boolean).length / count, misses };
}

function longestUsableMiss(misses: readonly Stretch[], totalMeters: number): Stretch | undefined {
  let best: Stretch | undefined;
  for (const miss of misses) {
    const startMeters = Math.max(miss.startMeters, END_CLEARANCE_METERS);
    const endMeters = Math.min(miss.endMeters, totalMeters - END_CLEARANCE_METERS);
    const length = endMeters - startMeters;
    if (length >= MIN_MISS_METERS && (!best || length > best.endMeters - best.startMeters)) best = { startMeters, endMeters };
  }
  return best;
}

/** `routeThrough(stops)` returns the car route from pickup to drop through `stops` in order. */
export async function planCheckpoints<R extends RoutedPath>(
  safeShape: readonly LngLat[],
  routeThrough: (stops: readonly LngLat[]) => Promise<R>,
): Promise<CheckpointPlan<R>> {
  const safe = measurePath(safeShape);
  const direct = await routeThrough([]);
  const directMeasure = measureCoverage(safe, direct.shape);

  let checkpoints: Checkpoint[] = [];
  let route = direct;
  let { coverage, misses } = directMeasure;
  while (coverage < TARGET_COVERAGE && checkpoints.length < MAX_CHECKPOINTS) {
    const miss = longestUsableMiss(misses, safe.totalMeters);
    if (!miss) break;
    const alongMeters = (miss.startMeters + miss.endMeters) / 2;
    const next = [...checkpoints, { point: safe.pointAt(alongMeters), alongMeters }].sort((a, b) => a.alongMeters - b.alongMeters);
    const candidate = await routeThrough(next.map((c) => c.point)).catch(() => undefined);
    if (!candidate || candidate.distanceMeters > safe.totalMeters * MAX_LENGTH_RATIO) break;
    const measured = measureCoverage(safe, candidate.shape);
    if (measured.coverage <= coverage) break;
    checkpoints = next;
    route = candidate;
    ({ coverage, misses } = measured);
  }
  return { checkpoints, route, coverage, direct, directCoverage: directMeasure.coverage };
}
