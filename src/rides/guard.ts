/**
 * Route guard: whether a ride has left the route it was booked on.
 *
 * Same rule Namma Yatri applies to its own expected route (route deviation in the driver
 * platform's LocationUpdates): the ride is off route once the last OFF_ROUTE_POINTS driver
 * positions are all more than OFF_ROUTE_METERS from the route. Needing consecutive points
 * absorbs single GPS jumps between tall buildings; one position back on the route clears it.
 * Progress is the latest position projected onto the route, as a share of its length.
 */
import type { LngLat } from "../geo/geometry.js";
import { nearestOnPath, type MeasuredPath } from "../geo/path.js";

export const OFF_ROUTE_METERS = 100;
export const OFF_ROUTE_POINTS = 3;

export interface GuardState {
  readonly offRoute: boolean;
  readonly metersOff: number;
  readonly progress: number;
}

export function guardRide(positions: readonly LngLat[], route: MeasuredPath): GuardState | undefined {
  if (positions.length === 0 || route.totalMeters <= 0) return undefined;
  const recent = positions.slice(-OFF_ROUTE_POINTS).map((p) => nearestOnPath(route, p));
  const latest = recent.at(-1)!;
  return {
    offRoute: recent.length === OFF_ROUTE_POINTS && recent.every((r) => r.distanceMeters > OFF_ROUTE_METERS),
    metersOff: Math.round(latest.distanceMeters),
    progress: Math.min(1, latest.alongMeters / route.totalMeters),
  };
}
