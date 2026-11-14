import type { Poi } from "../city/cityData.js";
import type { OpenState } from "../city/openingHours.js";
import { BREAKDOWN_HELP, SAFETY_STOPS } from "./features/categories.js";
import { midMeters } from "./features/along.js";
import type { RouteStop, SegmentContext, StopKind } from "./types.js";

const REACH_METERS: Readonly<Record<StopKind, number>> = { safety: 150, breakdown: 300 };

function kindsFor(poi: Poi, distanceMeters: number): StopKind[] {
  const kinds: StopKind[] = [];
  if ((SAFETY_STOPS.has(poi.cat) || poi.hours === "24/7") && distanceMeters <= REACH_METERS.safety) kinds.push("safety");
  if (BREAKDOWN_HELP.has(poi.cat) && distanceMeters <= REACH_METERS.breakdown) kinds.push("breakdown");
  return kinds;
}

/** Places along the route that can help, pinned to the segment they are closest to. */
export function findRouteStops(
  segments: readonly SegmentContext[],
  stateAt: (poi: Poi, at: Date) => OpenState,
): RouteStop[] {
  const closest = new Map<string, { segment: SegmentContext; poi: Poi; distanceMeters: number }>();
  for (const segment of segments) {
    for (const { poi, distanceMeters } of segment.nearby) {
      const previous = closest.get(poi.id);
      if (!previous || distanceMeters < previous.distanceMeters) closest.set(poi.id, { segment, poi, distanceMeters });
    }
  }

  const stops: RouteStop[] = [];
  for (const { segment, poi, distanceMeters } of closest.values()) {
    const kinds = kindsFor(poi, distanceMeters);
    if (kinds.length === 0) continue;
    const state = stateAt(poi, segment.arrival);
    stops.push({
      id: poi.id,
      kinds,
      category: poi.cat,
      ...(poi.name ? { name: poi.name } : {}),
      point: [poi.lon, poi.lat],
      alongMeters: midMeters(segment),
      arrival: segment.arrival,
      open: state.open,
      estimated: state.estimated,
      ...(state.closesAt ? { closesAt: state.closesAt } : {}),
    });
  }
  return stops.sort((a, b) => a.alongMeters - b.alongMeters);
}
