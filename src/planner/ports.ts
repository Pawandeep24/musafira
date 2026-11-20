import type { Poi } from "#src/city/cityData.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { Place } from "#src/city/placeSearch.js";
import type { BBox, LngLat } from "#src/geo/geometry.js";
import type { CommunityReport } from "#src/safety/community.js";
import type { CandidateRoute, RoadSpan, RouteAnalysis } from "#src/safety/types.js";

export type { Place };

export interface RouteProvider {
  /** Two-wheeler route candidates from `from` to `to`, best first. */
  routes(from: LngLat, to: LngLat): Promise<CandidateRoute[]>;
}

export interface StoredRoute {
  readonly city: CityIndex;
  readonly departAt: Date;
  readonly analysis: RouteAnalysis;
  analyze(route: CandidateRoute): RouteAnalysis;
}

export interface PlannedRoutes {
  route(searchId: string, routeId: string): StoredRoute;
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

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolOutcome {
  readonly callId: string;
  readonly content: string;
  readonly isError: boolean;
}

/** One model reply. `raw` goes back unchanged on the next request, so blocks we don't read (thinking) survive the tool loop. */
export interface ChatTurn {
  readonly text: string;
  readonly calls: readonly ToolCall[];
  readonly stop: "tools" | "done" | "truncated" | "refused";
  readonly raw: unknown;
  readonly costUsd: number;
}

export type ChatMessage =
  | { readonly kind: "text"; readonly role: "user" | "assistant"; readonly text: string }
  | { readonly kind: "turn"; readonly turn: ChatTurn }
  | { readonly kind: "results"; readonly results: readonly ToolOutcome[] };

export interface ChatRequest {
  /** Same for every request, so it is cached; `context` follows it and may change each time. */
  readonly system: string;
  readonly context: string;
  readonly tools: readonly ToolSpec[];
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
}

export interface ChatModel {
  chat(request: ChatRequest): Promise<ChatTurn>;
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
