import type { Place } from "../city/placeSearch.js";
import type { BBox, LngLat } from "../geo/geometry.js";
import type { CommunityReport } from "../safety/community.js";
import type { CandidateRoute } from "../safety/types.js";

export type { Place };

export interface RouteProvider {
  /** Two-wheeler route candidates from `from` to `to`, best first. */
  routes(from: LngLat, to: LngLat): Promise<CandidateRoute[]>;
}

export interface TrafficReading {
  readonly currentSpeedKmh: number;
  readonly freeFlowSpeedKmh: number;
  readonly confidence: number;
  readonly roadClosure: boolean;
}

export interface TrafficProvider {
  flowAt(point: LngLat): Promise<TrafficReading | undefined>;
}

export interface Geocoder {
  suggest(text: string, focus: LngLat, within: BBox): Promise<Place[]>;
  reverse(point: LngLat): Promise<Place | undefined>;
}

export interface ReportSource {
  active(cityId: string): readonly CommunityReport[];
}
