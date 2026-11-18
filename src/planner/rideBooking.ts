/**
 * Books Musafira's safe route as a ride and watches it. Two modes:
 *
 *   live → Namma Yatri, for a rider who linked their account with a code; Bengaluru only, and
 *          only for rides leaving now, because a booking leaves now and the plan's scores are
 *          for its departure time. Offered only when the service is created with `live` on
 *   demo → the same flow against a simulated driver and the city's meter tariff, contacting
 *          no one; any city with a tariff
 *
 * A quote prices the safe route through safety checkpoints and the usual route (ridePricing).
 * Both options are analysed at the plan's departure time with the plan's weights and rider
 * reports, so "+₹X for N points safer" compares like with like.
 *
 * Booking (live) selects one estimate, the only step that asks drivers; liveRides then follows
 * the booking a driver accepts. Live rides answer only to the session that booked them, and
 * unlinking ends their tracking too.
 */
import { randomUUID } from "node:crypto";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { LngLat } from "#src/geo/geometry.js";
import { measurePath } from "#src/geo/path.js";
import { AppError } from "#src/lib/errors.js";
import { TtlCache } from "#src/lib/ttlCache.js";
import { measureCoverage } from "#src/rides/checkpoints.js";
import { canDetour, demoSnapshot, hasMeterTariff } from "#src/rides/demoRide.js";
import type { ScoringOptions, Weights } from "#src/safety/parameters.js";
import { scoreRoute } from "#src/safety/scoring.js";
import type { RouteAnalysis } from "#src/safety/types.js";
import { createLiveRides } from "#src/planner/liveRides.js";
import type { CarRouter, PlannedRoutes, RideEstimate, RideHailing, StoredRoute } from "#src/planner/ports.js";
import { namer, priceDemo, priceLive, type Priced, type PricedTrip } from "#src/planner/ridePricing.js";
import { createRideSessions, notLinked } from "#src/planner/rideSessions.js";
import type { NamedPoint, RideBase, RideMode, RideRecord, RideView } from "#src/planner/rideTypes.js";
import { CANCELLABLE, viewRide } from "#src/planner/rideView.js";

const LIVE_CITIES: ReadonlySet<string> = new Set(["bengaluru"]);
const LIVE_WINDOW_MS = 15 * 60_000;
const QUOTE_TTL_MS = 10 * 60_000;
const RIDE_TTL_MS = 4 * 60 * 60_000;

export interface RideSupport {
  readonly live: boolean;
  readonly demo: boolean;
}

export interface RideOption {
  readonly kind: "safe" | "direct";
  readonly shape: readonly LngLat[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly score: number;
  /** Share of Musafira's safe route this ride follows. */
  readonly coverage: number;
  /** Empty when the ride app couldn't price this route. */
  readonly estimates: readonly RideEstimate[];
}

export interface RideQuote {
  readonly quoteId: string;
  readonly mode: RideMode;
  readonly city: CityIndex;
  readonly departAt: Date;
  /** Score of the planned safe route itself, for reference. */
  readonly planScore: number;
  readonly pickup: NamedPoint;
  readonly drop: NamedPoint;
  readonly checkpoints: readonly NamedPoint[];
  /** The safe option first; the direct one only when checkpoints were needed. */
  readonly options: readonly RideOption[];
  readonly expiresAt: Date;
}

export interface QuoteRequest {
  readonly searchId: string;
  readonly routeId: string;
  readonly mode: RideMode;
  readonly session?: string;
  readonly weights: Weights;
  readonly options: ScoringOptions;
}

export interface BookRequest {
  readonly quoteId: string;
  readonly estimateId: string;
  readonly confirm: boolean;
  readonly session?: string;
}

export interface RideBooking {
  support(cityId: string): RideSupport;
  link(code: string): Promise<string>;
  isLinked(session: string | undefined): boolean;
  unlink(session: string | undefined): void;
  quote(request: QuoteRequest): Promise<RideQuote>;
  book(request: BookRequest): Promise<RideView>;
  status(ref: string, session?: string): Promise<RideView>;
  cancel(ref: string, session?: string): Promise<RideView>;
  detour(ref: string): RideView;
}

export interface RideBookingDeps {
  readonly planner: PlannedRoutes;
  readonly car: CarRouter;
  readonly hailing: RideHailing;
  /** Offer live Namma Yatri booking; when false only demo rides exist. */
  readonly live: boolean;
  readonly now?: () => Date;
}

interface StoredQuote extends RideQuote {
  readonly session?: string;
  booking: boolean;
}

const shapeOf = (analysis: RouteAnalysis): LngLat[] => analysis.segments.flatMap((s, i) => (i === 0 ? s.path : s.path.slice(1)));

const rideNotFound = () => new AppError(404, "RIDE_NOT_FOUND", "This ride is no longer being tracked here.");
const cannotCancel = () => new AppError(409, "CANNOT_CANCEL", "This ride has already started, so it can't be cancelled here.");

export function createRideBooking({ planner, car, hailing, live, now = () => new Date() }: RideBookingDeps): RideBooking {
  const support = (cityId: string): RideSupport => ({ live: live && LIVE_CITIES.has(cityId), demo: hasMeterTariff(cityId) });
  const requireLive = () => {
    if (!live) throw new AppError(422, "LIVE_OFF", "Live Namma Yatri booking isn't available right now. Try a demo ride.");
  };
  const sessions = createRideSessions();
  const liveRides = createLiveRides({ hailing, sessions, now });
  const quotes = new TtlCache<string, StoredQuote>(QUOTE_TTL_MS, 500);
  const rides = new TtlCache<string, RideRecord>(RIDE_TTL_MS, 500);

  const liveTrip = async ({ city, departAt }: StoredRoute, safeShape: readonly LngLat[], session: string | undefined): Promise<PricedTrip> => {
    requireLive();
    if (!LIVE_CITIES.has(city.id)) {
      throw new AppError(422, "NY_NOT_IN_CITY", `Namma Yatri books rides in Bengaluru. Try a demo ride in ${city.data.name}.`);
    }
    if (Math.abs(departAt.getTime() - now().getTime()) > LIVE_WINDOW_MS) {
      throw new AppError(422, "LIVE_NOT_NOW", "Live rides leave now. Plan this trip for now to book it, or try a demo ride.");
    }
    if (!session) throw notLinked();
    return sessions.signedIn(session, (token) => priceLive(hailing, car, token, city, safeShape));
  };

  const view = (ride: RideRecord): RideView => viewRide(ride, now(), (rideId) => hailing.shareUrl(rideId));

  const rideFor = (ref: string, session: string | undefined): RideRecord => {
    const ride = rides.get(ref);
    if (!ride || (ride.mode === "live" && ride.session !== session)) throw rideNotFound();
    return ride;
  };

  return {
    support,

    async link(code) {
      requireLive();
      return sessions.open(await hailing.signIn(code));
    },

    isLinked: (session) => sessions.isLinked(session),

    unlink(session) {
      sessions.close(session);
    },

    async quote({ searchId, routeId, mode, session, weights, options }) {
      const stored = planner.route(searchId, routeId);
      const safeShape = shapeOf(stored.analysis);
      const safe = measurePath(safeShape);
      const trip = mode === "live" ? await liveTrip(stored, safeShape, session) : await priceDemo(car, stored, safeShape);

      const option = async (kind: RideOption["kind"], { route, estimates }: Priced): Promise<RideOption> => {
        const analysis = stored.analyze({ ...route, roads: await car.roadsAlong(route.shape) });
        return {
          kind,
          shape: route.shape,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          score: scoreRoute(analysis, weights, options).score,
          coverage: measureCoverage(safe, route.shape).coverage,
          estimates,
        };
      };
      const rideOptions = await Promise.all([option("safe", trip.safe), ...(trip.direct ? [option("direct", trip.direct)] : [])]);

      const name = namer(stored.city);
      const quote: StoredQuote = {
        quoteId: randomUUID(),
        mode,
        city: stored.city,
        departAt: stored.departAt,
        planScore: scoreRoute(stored.analysis, weights, options).score,
        pickup: name(safeShape[0]!),
        drop: name(safeShape.at(-1)!),
        checkpoints: trip.checkpoints.map((c) => name(c.point)),
        options: rideOptions,
        expiresAt: new Date(now().getTime() + QUOTE_TTL_MS),
        ...(mode === "live" ? { session } : {}),
        booking: false,
      };
      quotes.set(quote.quoteId, quote);
      const { session: _session, booking: _booking, ...shown } = quote;
      return shown;
    },

    async book({ quoteId, estimateId, confirm, session }) {
      const quote = quotes.get(quoteId);
      if (!quote) throw new AppError(404, "QUOTE_EXPIRED", "These fares have expired. Get fresh fares to book.");
      const option = quote.options.find((o) => o.estimates.some((e) => e.id === estimateId));
      const estimate = option?.estimates.find((e) => e.id === estimateId);
      if (!option || !estimate) throw new AppError(404, "ESTIMATE_NOT_FOUND", "That fare is not part of this quote.");
      if (quote.booking) throw new AppError(409, "ALREADY_BOOKING", "This ride is already being booked.");

      const base: RideBase = {
        ref: randomUUID(),
        city: quote.city,
        route: measurePath(option.shape),
        checkpoints: option.kind === "safe" ? quote.checkpoints : [],
        estimate,
        bookedAt: now(),
      };
      let ride: RideRecord;
      if (quote.mode === "demo") {
        ride = { ...base, mode: "demo", demo: { bookedAt: base.bookedAt, route: base.route } };
      } else {
        if (!confirm) throw new AppError(400, "CONFIRM_REQUIRED", "Confirm the booking first: it asks real drivers.");
        if (!session || quote.session !== session) throw notLinked();
        quote.booking = true;
        try {
          await sessions.signedIn(session, (token) => hailing.select(token, estimateId));
        } catch (error) {
          quote.booking = false;
          throw error;
        }
        ride = {
          ...base,
          mode: "live",
          session,
          status: "searching",
          positions: [],
          refreshedAt: base.bookedAt.getTime(),
          stale: false,
          cancelledByRider: false,
        };
      }
      quotes.delete(quoteId);
      rides.set(ride.ref, ride);
      return view(ride);
    },

    async status(ref, session) {
      const ride = rideFor(ref, session);
      if (ride.mode === "live") await liveRides.refresh(ride);
      return view(ride);
    },

    async cancel(ref, session) {
      const ride = rideFor(ref, session);
      if (ride.mode === "demo") {
        if (!CANCELLABLE.has(demoSnapshot(ride.demo, now()).status)) throw cannotCancel();
        ride.demo = { ...ride.demo, cancelledAt: now() };
        return view(ride);
      }

      await liveRides.refresh(ride, true);
      if (!CANCELLABLE.has(ride.status)) throw cannotCancel();
      await liveRides.cancel(ride);
      return view(ride);
    },

    detour(ref) {
      const ride = rides.get(ref);
      if (!ride || ride.mode !== "demo") throw rideNotFound();
      if (!canDetour(ride.demo, now())) throw new AppError(409, "NO_DETOUR", "A wrong turn can only be simulated mid-ride.");
      ride.demo = { ...ride.demo, detourAt: now() };
      return view(ride);
    },
  };
}
