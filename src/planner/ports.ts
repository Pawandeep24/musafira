import type { Poi } from "#src/city/cityData.js";
import type { Place } from "#src/city/placeSearch.js";
import type { BBox, LngLat } from "#src/geo/geometry.js";
import type { CommunityReport } from "#src/safety/community.js";
import type { CandidateRoute, RoadSpan } from "#src/safety/types.js";

export type { Place };

export interface RouteProvider {
  /** Two-wheeler route candidates from `from` to `to`, best first. */
  routes(from: LngLat, to: LngLat): Promise<CandidateRoute[]>;
}

export interface CarRouter {
  /** The car route from the first point to the last, passing the others in order; no road classes. */
  through(points: readonly LngLat[]): Promise<CandidateRoute>;
  /** Road classes along a route drawn by someone else; empty when it can't be matched to the map. */
  roadsAlong(shape: readonly LngLat[]): Promise<RoadSpan[]>;
}

export interface RidePlace {
  readonly point: LngLat;
  readonly name?: string;
}

export interface RideTrip {
  readonly pickup: RidePlace;
  readonly stops: readonly RidePlace[];
  readonly drop: RidePlace;
  readonly cityName: string;
}

export interface RideSearch {
  readonly searchId: string;
  /** The route the ride app plans for the trip, when it shares one. */
  readonly route?: { readonly points: readonly LngLat[]; readonly distanceMeters?: number; readonly durationSeconds?: number };
}

export interface RideEstimate {
  readonly id: string;
  readonly tier: string;
  readonly fare: number;
  readonly minFare?: number;
  readonly maxFare?: number;
  readonly pickupSeconds?: number;
}

export interface RideDriver {
  readonly name?: string;
  readonly vehicleNumber?: string;
  readonly vehicle?: string;
  readonly otp?: string;
}

export interface RideBookingInfo {
  readonly id: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly rideId?: string;
  readonly rideStatus?: string;
  readonly driver?: RideDriver;
}

export interface RideProgress {
  readonly status: string;
  readonly driver: RideDriver;
  readonly position?: LngLat;
}

/** A ride-hailing app acting for one signed-in rider (the token). */
export interface RideHailing {
  signIn(code: string): Promise<string>;
  search(token: string, trip: RideTrip): Promise<RideSearch>;
  estimates(token: string, searchId: string): Promise<RideEstimate[]>;
  select(token: string, estimateId: string): Promise<void>;
  recentBookings(token: string): Promise<RideBookingInfo[]>;
  rideProgress(token: string, rideId: string): Promise<RideProgress>;
  cancelSearch(token: string, estimateId: string): Promise<void>;
  cancelBooking(token: string, bookingId: string, driverAssigned: boolean): Promise<void>;
  shareUrl(rideId: string): string;
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

export interface SafeStopSource {
  /** Listed Safe Stops in a city, as places a route can pass. */
  listed(cityId: string): readonly Poi[];
}

export interface DomainLookup {
  /** TXT values published at `name`, each record's strings joined; empty when there are none. */
  txt(name: string): Promise<string[]>;
  /** Who a domain is registered with; undefined when it isn't registered. */
  registrar(domain: string): Promise<string | undefined>;
}

export interface TextRequest {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
}

export interface TextReply {
  readonly text: string;
  readonly costUsd: number;
}

export interface TextModel {
  complete(request: TextRequest): Promise<TextReply>;
}

export interface SiteMail {
  readonly replyTo: { readonly name: string; readonly address: string };
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  /** The site's own mailbox: every message is delivered there, and it is shown to visitors. */
  readonly address: string;
  send(mail: SiteMail): Promise<void>;
}
