export type LngLat = [lon: number, lat: number];

export type ParameterId =
  | "lighting"
  | "safetyStops"
  | "crowd"
  | "signal"
  | "essentialServices"
  | "openShops"
  | "breakdownHelp"
  | "roadType";

export type Weights = Record<ParameterId, number>;

export interface ScoringOptions {
  darkStretchMeters: number;
  maxStopGapMeters: number;
}

export interface ParameterInfo {
  id: ParameterId;
  label: string;
  description: string;
  defaultWeight: number;
}

export interface Preset {
  id: string;
  label: string;
  weights: Weights;
}

export interface DataSource {
  name: string;
  license: string;
  attribution: string;
  url: string;
}

export interface City {
  id: string;
  name: string;
  center: LngLat;
  bbox: { west: number; south: number; east: number; north: number };
  utcOffsetMinutes: number;
  version: string;
  sources: DataSource[];
}

export interface AppConfig {
  parameters: ParameterInfo[];
  maxWeight: number;
  presets: Preset[];
  defaults: { weights: Weights; options: ScoringOptions };
  cities: City[];
}

export type PlaceKind = "area" | "residence" | "landmark" | "street";

export interface Place {
  id: string;
  name: string;
  label: string;
  point: LngLat;
  kind?: PlaceKind;
}

export interface Stretch {
  startMeters: number;
  endMeters: number;
  path: LngLat[];
}

export interface Segment {
  startMeters: number;
  endMeters: number;
  path: LngLat[];
  arrival: string;
  dark: boolean;
  score: number | null;
  values: Record<ParameterId, number | null>;
}

export type PoiCategory =
  | "police"
  | "hospital"
  | "clinic"
  | "doctors"
  | "pharmacy"
  | "fuel"
  | "hotel"
  | "convenience"
  | "supermarket"
  | "shop"
  | "restaurant"
  | "cafe"
  | "fast_food"
  | "bike_repair"
  | "bus_stop"
  | "transit_station";

export interface Stop {
  id: string;
  kinds: ("safety" | "breakdown")[];
  category: PoiCategory;
  name?: string;
  point: LngLat;
  alongMeters: number;
  arrival: string;
  open: boolean;
  estimated: boolean;
  closesAt: string | null;
}

export type ReportCategory =
  | "poorlyLit"
  | "wellLit"
  | "deserted"
  | "busy"
  | "harassment"
  | "loitering"
  | "policeNearby"
  | "badRoad"
  | "waterlogged"
  | "noSignal";

export type ReportWhen = "now" | "morning" | "afternoon" | "evening" | "night";

export interface RouteReport {
  category: ReportCategory;
  alongMeters: number;
  count: number;
  lastObservedAt: string;
}

export interface TripReport {
  category: ReportCategory;
  point: LngLat;
  count: number;
  lastObservedAt: string;
  routeIds: string[];
}

export interface Route {
  id: string;
  labels: ("safest" | "fastest")[];
  score: number;
  confidence: number;
  distanceMeters: number;
  durationSeconds: number;
  departAt: string;
  arriveAt: string;
  liveTraffic: boolean;
  roadClosed: boolean;
  breakdown: Record<ParameterId, number | null>;
  penalties: { darkStretches: number; deadZones: number; stopGap: number; reported: number };
  longestStopGapMeters: number;
  darkStretches: Stretch[];
  deadZones: Stretch[];
  segments: Segment[];
  stops: Stop[];
  reports: RouteReport[];
}

export interface Plan {
  searchId: string;
  city: { id: string; name: string; dataVersion: string };
  departAt: string;
  routes: Route[];
  reports: TripReport[];
}

export interface Grid {
  west: number;
  north: number;
  cellDegrees: number;
  cols: number;
  rows: number;
  values: (number | null)[];
}

export interface CityLayers {
  lights: Grid | null;
  cellDensity: Grid | null;
}

export interface Preferences {
  weights: Weights;
  options: ScoringOptions;
  presetId?: string;
}
