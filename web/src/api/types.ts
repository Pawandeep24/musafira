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
  rides: { live: boolean; demo: boolean };
}

export interface AppConfig {
  contactEmail?: string;
  parameters: ParameterInfo[];
  maxWeight: number;
  presets: Preset[];
  defaults: { weights: Weights; options: ScoringOptions };
  cities: City[];
}

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
  website?: string;
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
  | "transit_station"
  | "safe_stop";

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

export type TripDays = 0.5 | 1 | 2 | 3;
export type TripInterest = "food" | "heritage" | "temples" | "nature" | "markets" | "cafes";
export type TripDiet = "veg" | "egg" | "any";
export type TripBackBy = "sunset" | "20:00" | "22:00";
export type TripSlot = "breakfast" | "morning" | "lunch" | "afternoon" | "snack" | "dinner";
export type SightKind = "heritage" | "museum" | "worship" | "nature" | "market" | "attraction";

export interface TripAnswers {
  days: TripDays;
  interests: TripInterest[];
  diet: TripDiet;
  backBy: TripBackBy;
}

export interface ItineraryStop {
  id: string;
  slot: TripSlot;
  name: string;
  area: string | null;
  kind: SightKind | "restaurant" | "cafe" | "fast_food";
  famous: boolean;
  point: LngLat;
  arriveAt: string;
  leaveAt: string;
  closesAt: string | null;
  note: string | null;
}

export interface ItineraryLeg {
  from: LngLat;
  to: LngLat;
  departAt: string;
  arriveAt: string;
  distanceMeters: number;
  dark: boolean;
}

export interface ItineraryDay {
  index: number;
  startAt: string;
  endAt: string;
  dusk: string;
  stops: ItineraryStop[];
  legs: ItineraryLeg[];
}

export interface Itinerary {
  title: string;
  source: "ai" | "basic";
  fallback: "not_configured" | "unavailable" | "daily_limit" | null;
  city: { id: string; name: string; utcOffsetMinutes: number };
  base: { name: string; point: LngLat };
  days: ItineraryDay[];
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

export type RideMode = "live" | "demo";
export type RideOptionKind = "safe" | "direct";
export type RideStatus = "searching" | "assigned" | "riding" | "completed" | "cancelled" | "no_driver";

export interface RidePlace {
  point: LngLat;
  name: string | null;
}

export interface RideEstimate {
  id: string;
  tier: string;
  fare: number;
  minFare: number | null;
  maxFare: number | null;
  pickupSeconds: number | null;
}

export interface RideOption {
  kind: RideOptionKind;
  path: LngLat[];
  distanceMeters: number;
  durationSeconds: number;
  score: number;
  coverage: number;
  estimates: RideEstimate[];
}

export interface RideQuote {
  quoteId: string;
  mode: RideMode;
  city: { id: string; name: string };
  departAt: string;
  expiresAt: string;
  planScore: number;
  pickup: RidePlace;
  drop: RidePlace;
  checkpoints: RidePlace[];
  options: RideOption[];
}

export interface RideDriver {
  name: string | null;
  vehicleNumber: string | null;
  vehicle: string | null;
  otp: string | null;
}

export interface Ride {
  ref: string;
  mode: RideMode;
  status: RideStatus;
  city: { id: string; name: string };
  route: LngLat[];
  checkpoints: RidePlace[];
  tier: string;
  fare: number;
  driver: RideDriver | null;
  position: LngLat | null;
  area: string | null;
  pickupSeconds: number | null;
  guard: { offRoute: boolean; metersOff: number; progress: number } | null;
  shareUrl: string | null;
  reassigning: boolean;
  cancelledByRider: boolean;
  stale: boolean;
  canCancel: boolean;
  cancelFee: boolean;
  canDetour: boolean;
}

export type SafeStopKind = "cafe" | "restaurant" | "shop" | "pharmacy" | "fuel" | "hotel" | "clinic" | "other";

export type Language = "kn" | "mr" | "hi" | "en" | "ta" | "te" | "ur";

export type SafeStopFeature =
  | "washroom_inside"
  | "separate_entry"
  | "lock_inside"
  | "lit_inside"
  | "running_water"
  | "soap"
  | "helmet_hook"
  | "western_toilet"
  | "indian_toilet"
  | "tampons"
  | "menstrual_cups"
  | "disposal_bin"
  | "pad_vending"
  | "painkillers"
  | "staff_always"
  | "woman_on_shift"
  | "cctv"
  | "lit_entrance"
  | "guard"
  | "wait_inside"
  | "seating"
  | "first_aid"
  | "drinking_water"
  | "charging"
  | "parking_watched"
  | "covered_parking"
  | "tyre_help"
  | "all_genders"
  | "step_free"
  | "baby_changing"
  | "feeding_space";

export type SafeStopHours = { allDay: true } | { opens: string; closes: string };

export interface SafeStopProfile {
  name: string;
  kind: SafeStopKind;
  point: LngLat;
  hours: SafeStopHours;
  languages: Language[];
  washrooms: { total: number; women: number; unisex: number; accessible: number };
  access: "anyone" | "customers" | "paid";
  feeRupees?: number;
  attendant: "always" | "daytime" | "none";
  pads: "free" | "sold" | "none";
  cleaned: "hourly" | "few_daily" | "daily";
  features: SafeStopFeature[];
  offer?: string;
  promise: true;
  domain: string;
}

export interface OwnedSafeStop {
  id: string;
  status: "draft" | "listed";
  cityId: string;
  profile: SafeStopProfile;
  verify: { name: string; value: string };
  registrar: string | null;
  verifiedAt: string | null;
}

export interface PublicSafeStop {
  id: string;
  cityId: string;
  profile: SafeStopProfile;
  registrar: string | null;
  verifiedAt: string | null;
  open: boolean;
  closesAt: string | null;
}

export interface VerifyChecks {
  codeFound: boolean;
  registrar: string | null;
  godaddy: boolean;
}

export interface DomainIdea {
  domain: string;
  available: boolean | null;
  buyUrl: string;
}

export interface WashroomFacts {
  women?: boolean;
  free?: boolean;
  pads?: boolean;
  attendant?: boolean;
  lockInside?: boolean;
  wheelchair?: boolean;
  babyChanging?: boolean;
}

export interface Washroom {
  id: string;
  source: "safeStop" | "public" | "fuel";
  name?: string;
  point: LngLat;
  facts: WashroomFacts;
  safeStopId?: string;
  distanceMeters: number;
  rideMinutes: number;
  estimated: boolean;
  closesAt: string | null;
}

export interface WashroomsNear {
  cityId: string;
  at: string;
  washrooms: Washroom[];
}
