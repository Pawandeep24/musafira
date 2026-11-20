/**
 * Places of one category a rider can stop at on a planned route, for errands "on the way".
 *
 * A place counts when it is within 200 m of a segment's midpoint; segments are 100 m long, so that is
 * a corridor of roughly 190 m either side of the road. Each place is pinned to its closest segment and
 * judged open at that segment's arrival minute, the same way route stops are, so a pharmacy that
 * closes before the rider gets there is left out. Results are in riding order, nearer the road first.
 */
import type { Poi, PoiCategory } from "#src/city/cityData.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { HoursEvaluator } from "#src/city/openingHours.js";
import { haversineMeters } from "#src/geo/geometry.js";
import { midMeters } from "#src/safety/features/along.js";
import type { Segment } from "#src/safety/types.js";

const REACH_METERS = 200;

export interface PlaceOnRoute {
  readonly poi: Poi;
  readonly alongMeters: number;
  readonly offMeters: number;
  readonly passAt: Date;
  readonly estimated: boolean;
  readonly closesAt?: Date;
}

export interface AlongRouteInput {
  readonly city: CityIndex;
  readonly hours: HoursEvaluator;
  readonly safeStops: readonly Poi[];
  readonly segments: readonly Segment[];
  readonly category: PoiCategory;
}

export function openAlongRoute({ city, hours, safeStops, segments, category }: AlongRouteInput): PlaceOnRoute[] {
  const extra = safeStops.filter((poi) => poi.cat === category);
  const closest = new Map<string, { poi: Poi; segment: Segment; meters: number }>();
  for (const segment of segments) {
    const near = [
      ...city.poisWithin(segment.midpoint, REACH_METERS).flatMap(({ poi, distanceMeters }) => (poi.cat === category ? [{ poi, meters: distanceMeters }] : [])),
      ...extra.flatMap((poi) => {
        const meters = haversineMeters(segment.midpoint, [poi.lon, poi.lat]);
        return meters <= REACH_METERS ? [{ poi, meters }] : [];
      }),
    ];
    for (const { poi, meters } of near) {
      const previous = closest.get(poi.id);
      if (!previous || meters < previous.meters) closest.set(poi.id, { poi, segment, meters });
    }
  }
  return [...closest.values()]
    .flatMap(({ poi, segment, meters }) => {
      const state = hours.stateAt(poi, segment.arrival);
      if (!state.open) return [];
      return [
        {
          poi,
          alongMeters: midMeters(segment),
          offMeters: meters,
          passAt: segment.arrival,
          estimated: state.estimated,
          ...(state.closesAt ? { closesAt: state.closesAt } : {}),
        },
      ];
    })
    .sort((a, b) => a.alongMeters - b.alongMeters || a.offMeters - b.offMeters);
}
