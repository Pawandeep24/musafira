import type { NearbyPoi } from "#src/city/cityIndex.js";
import type { PoiCategory } from "#src/city/cityData.js";
import type { LngLat } from "#src/geo/geometry.js";
import type { RouteReport } from "#src/safety/community.js";
import type { ParameterId } from "#src/safety/parameters.js";

/** A feature value in 0..1, "missing" when data is absent, "n/a" when it does not apply (e.g. lighting by day). */
export type Measurement = number | "missing" | "n/a";

export interface RoadSpan {
  readonly endMeters: number;
  readonly roadClass: string;
  readonly tunnel: boolean;
}

/** A provider-neutral route candidate; `secondsAt[i]` is travel time to `shape[i]`. */
export interface CandidateRoute {
  readonly shape: readonly LngLat[];
  readonly secondsAt: readonly number[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly roads: readonly RoadSpan[];
}

export interface TrafficSample {
  readonly alongMeters: number;
  readonly currentSpeedKmh: number;
  readonly freeFlowSpeedKmh: number;
  readonly confidence: number;
  readonly roadClosure: boolean;
}

export interface Segment {
  readonly index: number;
  readonly startMeters: number;
  readonly endMeters: number;
  readonly path: readonly LngLat[];
  readonly midpoint: LngLat;
  readonly arrival: Date;
  readonly dark: boolean;
  readonly roadClass?: string;
  readonly tunnel: boolean;
}

export interface SegmentContext extends Segment {
  readonly nearby: readonly NearbyPoi[];
}

export type StopKind = "safety" | "breakdown";

export interface RouteStop {
  readonly id: string;
  readonly kinds: readonly StopKind[];
  readonly category: PoiCategory;
  readonly name?: string;
  readonly point: LngLat;
  readonly alongMeters: number;
  readonly arrival: Date;
  readonly open: boolean;
  readonly estimated: boolean;
  readonly closesAt?: Date;
}

export interface FeatureResult {
  readonly values: readonly Measurement[];
  /** 0..1 trust in the measured values, e.g. lower when opening hours are estimated. */
  readonly quality: number;
}

export interface RouteContext {
  readonly segments: readonly SegmentContext[];
  readonly stops: readonly RouteStop[];
  readonly traffic: readonly TrafficSample[];
  radianceAt(point: LngLat): number | undefined;
  cellDensityAt(point: LngLat): number | undefined;
  isOpen(poi: NearbyPoi["poi"], at: Date): { open: boolean; estimated: boolean };
}

export interface FeatureExtractor {
  readonly id: ParameterId;
  measure(context: RouteContext): FeatureResult;
}

/** Weight-independent facts about one route. Cached per search so re-weighting is instant. */
export interface RouteAnalysis {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly departAt: Date;
  readonly arriveAt: Date;
  readonly segments: readonly Segment[];
  readonly measurements: Readonly<Record<ParameterId, readonly Measurement[]>>;
  readonly quality: Readonly<Record<ParameterId, number>>;
  readonly stops: readonly RouteStop[];
  readonly reportedStretches: readonly Stretch[];
  readonly reports: readonly RouteReport[];
  /** Rider reports that affected this route at its ride time. */
  readonly reportIds: readonly string[];
  readonly roadClosed: boolean;
  readonly liveTraffic: boolean;
}

export interface Stretch {
  readonly startMeters: number;
  readonly endMeters: number;
}

export interface RouteScore {
  readonly score: number;
  readonly confidence: number;
  readonly breakdown: Readonly<Record<ParameterId, number | null>>;
  readonly segmentScores: readonly (number | null)[];
  readonly darkStretches: readonly Stretch[];
  readonly deadZones: readonly Stretch[];
  readonly longestStopGapMeters: number;
  readonly penalties: { readonly darkStretches: number; readonly deadZones: number; readonly stopGap: number; readonly reported: number };
}
