/**
 * Books Musafira's safe route as a ride and watches it. Two modes:
 *
 *   live → Namma Yatri, for a rider who linked their account with a code; Bengaluru only, and
 *          only for rides leaving now, because a booking leaves now and the plan's scores are
 *          for its departure time. Offered only when the service is created with `live` on
 *   demo → the same flow against a simulated driver and the city's meter tariff, contacting
 *          no one; any city with a tariff
 *
 * Quote (live): Namma Yatri's route with no stops → safety checkpoints where it strays from
 * the safe route (planCheckpoints; Valhalla's car profile routes the trial stops) → Namma
 * Yatri's route and fares through the checkpoints. Demo uses Valhalla car routes for both.
 * Both options are analysed at the plan's departure time with the plan's weights and rider
 * reports, so "+₹X for N points safer" compares like with like. When Namma Yatri can't price
 * the checkpoints, the safe option comes back without fares and its usual route stays bookable.
 *
 * Booking (live) selects one estimate, the only step that asks drivers. Namma Yatri creates
 * the booking once a driver accepts, so tracking matches the newest booking created after the
 * selection (allowing BOOKING_CLOCK_SKEW_MS), then follows its ride. No booking within
 * NO_DRIVER_AFTER_MS ends the search. Driver positions during the ride feed the route guard,
 * judged against the route the ride was booked on.
 *
 * Sessions map a random handle to the Namma Yatri token in memory only (12 h); the token never
 * reaches the browser or the logs. Live rides answer only to the session that booked them, and
 * unlinking ends their tracking too.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { CityIndex } from "#src/city/cityIndex.js";
import { haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { measurePath, type MeasuredPath } from "#src/geo/path.js";
import { AppError } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import { TtlCache } from "#src/lib/ttlCache.js";
import { measureCoverage, planCheckpoints, type Checkpoint } from "#src/rides/checkpoints.js";
import {
  canDetour,
  demoSnapshot,
  hasMeterTariff,
  meterFare,
  SHOWN_PICKUP_SECONDS,
  type DemoRide,
  type RideStatus,
} from "#src/rides/demoRide.js";
import { guardRide, type GuardState } from "#src/rides/guard.js";
import type { ScoringOptions, Weights } from "#src/safety/parameters.js";
import { scoreRoute } from "#src/safety/scoring.js";
import type { CandidateRoute, RouteAnalysis } from "#src/safety/types.js";
import type { CarRouter, RideDriver, RideEstimate, RideHailing, RideSearch } from "#src/planner/ports.js";
import type { RoutePlanner, StoredRoute } from "#src/planner/routePlanner.js";

const LIVE_CITIES: ReadonlySet<string> = new Set(["bengaluru"]);
const LIVE_WINDOW_MS = 15 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const QUOTE_TTL_MS = 10 * 60_000;
const RIDE_TTL_MS = 4 * 60 * 60_000;
const NO_DRIVER_AFTER_MS = 5 * 60_000;
const BOOKING_CLOCK_SKEW_MS = 2 * 60_000;
const LIVE_REFRESH_MS = 2500;
const GUARD_SAMPLE_MS = 2000;
const CITY_CAR_METERS_PER_SECOND = 6;
const PICKUP_METERS_PER_SECOND = 5;
const MAX_POSITIONS = 20;
const CANCELLABLE: ReadonlySet<RideStatus> = new Set(["searching", "assigned"]);
const FINISHED: ReadonlySet<RideStatus> = new Set(["completed", "cancelled", "no_driver"]);
const DRIVER_ASSIGNED_BOOKINGS = new Set(["TRIP_ASSIGNED", "CONFIRMED"]);
const REASSIGNING_BOOKINGS = new Set(["AWAITING_REASSIGNMENT", "REALLOCATED"]);

export type RideMode = "live" | "demo";

export interface RideSupport {
  readonly live: boolean;
  readonly demo: boolean;
}

export interface NamedPoint {
  readonly point: LngLat;
  readonly name?: string;
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

export interface RideView {
  readonly ref: string;
  readonly mode: RideMode;
  readonly status: RideStatus;
  readonly city: CityIndex;
  readonly route: readonly LngLat[];
  readonly checkpoints: readonly NamedPoint[];
  readonly tier: string;
  readonly fare: number;
  readonly driver?: RideDriver;
  readonly position?: LngLat;
  /** Area name near the driver, for alerts and shared messages. */
  readonly area?: string;
  readonly pickupSeconds?: number;
  readonly guard?: GuardState;
  readonly shareUrl?: string;
  /** The driver cancelled and the ride app is finding another. */
  readonly reassigning: boolean;
  readonly cancelledByRider: boolean;
  /** The last status update from the ride app failed; this is the previous state. */
  readonly stale: boolean;
  readonly canCancel: boolean;
  /** Cancelling now may cost the rider a fee (a driver is on the way). */
  readonly cancelFee: boolean;
  readonly canDetour: boolean;
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
  readonly planner: RoutePlanner;
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

interface RideBase {
  readonly ref: string;
  readonly city: CityIndex;
  readonly route: MeasuredPath;
  readonly checkpoints: readonly NamedPoint[];
  readonly estimate: RideEstimate;
  readonly bookedAt: Date;
}

interface DemoRecord extends RideBase {
  readonly mode: "demo";
  demo: DemoRide;
}

interface LiveRecord extends RideBase {
  readonly mode: "live";
  readonly session: string;
  status: RideStatus;
  bookingId?: string;
  bookingStatus?: string;
  rideId?: string;
  rideStatus?: string;
  driver?: RideDriver;
  position?: LngLat;
  readonly positions: LngLat[];
  refreshedAt: number;
  stale: boolean;
  cancelledByRider: boolean;
}

type RideRecord = DemoRecord | LiveRecord;

interface Priced {
  readonly route: CandidateRoute;
  readonly estimates: readonly RideEstimate[];
}

interface PricedTrip {
  readonly checkpoints: readonly Checkpoint[];
  readonly safe: Priced;
  readonly direct?: Priced;
}

const shapeOf = (analysis: RouteAnalysis): LngLat[] => analysis.segments.flatMap((s, i) => (i === 0 ? s.path : s.path.slice(1)));

/** A route from a ride app, timed evenly by distance because only its total duration is known. */
function timedRoute({ points, distanceMeters, durationSeconds }: NonNullable<RideSearch["route"]>): CandidateRoute {
  const path = measurePath(points);
  const distance = distanceMeters ?? path.totalMeters;
  const duration = durationSeconds ?? distance / CITY_CAR_METERS_PER_SECOND;
  return {
    shape: points,
    secondsAt: path.cumulative.map((m) => (path.totalMeters > 0 ? (m / path.totalMeters) * duration : 0)),
    distanceMeters: distance,
    durationSeconds: duration,
    roads: [],
  };
}

const demoDriver = (city: CityIndex, ref: string): RideDriver => ({
  name: "Demo driver",
  vehicleNumber: city.id === "pune" ? "MH 12 DEMO" : "KA 01 DEMO",
  vehicle: "Auto rickshaw",
  otp: String(parseInt(ref.slice(0, 4), 16) % 10_000).padStart(4, "0"),
});

const notLinked = () => new AppError(401, "NY_SIGNED_OUT", "Link your Namma Yatri account to book a live ride.");
const rideNotFound = () => new AppError(404, "RIDE_NOT_FOUND", "This ride is no longer being tracked here.");
const cannotCancel = () => new AppError(409, "CANNOT_CANCEL", "This ride has already started, so it can't be cancelled here.");

export function createRideBooking({ planner, car, hailing, live, now = () => new Date() }: RideBookingDeps): RideBooking {
  const support = (cityId: string): RideSupport => ({ live: live && LIVE_CITIES.has(cityId), demo: hasMeterTariff(cityId) });
  const requireLive = () => {
    if (!live) throw new AppError(422, "LIVE_OFF", "Live Namma Yatri booking isn't available right now. Try a demo ride.");
  };
  const sessions = new TtlCache<string, string>(SESSION_TTL_MS, 1000);
  const quotes = new TtlCache<string, StoredQuote>(QUOTE_TTL_MS, 500);
  const rides = new TtlCache<string, RideRecord>(RIDE_TTL_MS, 500);

  const tokenFor = (session: string | undefined): string => {
    const token = session ? sessions.get(session) : undefined;
    if (!token) throw notLinked();
    return token;
  };

  const signedIn = async <T>(session: string, call: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await call(tokenFor(session));
    } catch (error) {
      if (error instanceof AppError && error.code === "NY_SIGNED_OUT") sessions.delete(session);
      throw error;
    }
  };

  const namer = (city: CityIndex) => (point: LngLat): NamedPoint => {
    const name = city.places.areaNear(point);
    return name ? { point, name } : { point };
  };

  const pricedLive = async (stored: StoredRoute, safeShape: readonly LngLat[], session: string | undefined): Promise<PricedTrip> => {
    const { city, departAt } = stored;
    requireLive();
    if (!LIVE_CITIES.has(city.id)) {
      throw new AppError(422, "NY_NOT_IN_CITY", `Namma Yatri books rides in Bengaluru. Try a demo ride in ${city.data.name}.`);
    }
    if (Math.abs(departAt.getTime() - now().getTime()) > LIVE_WINDOW_MS) {
      throw new AppError(422, "LIVE_NOT_NOW", "Live rides leave now. Plan this trip for now to book it, or try a demo ride.");
    }
    if (!session) throw notLinked();
    const name = namer(city);
    const pickup = safeShape[0]!;
    const drop = safeShape.at(-1)!;

    return signedIn(session, async (token) => {
      const search = async (stops: readonly LngLat[], fallback: () => Promise<CandidateRoute>) => {
        const found = await hailing.search(token, { pickup: name(pickup), stops: stops.map(name), drop: name(drop), cityName: city.data.name });
        return { searchId: found.searchId, route: found.route ? timedRoute(found.route) : await fallback() };
      };
      const direct = await search([], () => car.through([pickup, drop]));

      const priceSafe = async (plan: { checkpoints: readonly Checkpoint[]; route: CandidateRoute }): Promise<Priced> => {
        try {
          const safe = await search(
            plan.checkpoints.map((c) => c.point),
            async () => plan.route,
          );
          return { route: safe.route, estimates: await hailing.estimates(token, safe.searchId) };
        } catch (error) {
          if (error instanceof AppError) throw error;
          return { route: plan.route, estimates: [] };
        }
      };

      const [directEstimates, safe] = await Promise.all([
        hailing.estimates(token, direct.searchId),
        planCheckpoints(safeShape, (stops) => (stops.length === 0 ? Promise.resolve(direct.route) : car.through([pickup, ...stops, drop]))).then(
          async (plan) => (plan.checkpoints.length === 0 ? undefined : { checkpoints: plan.checkpoints, priced: await priceSafe(plan) }),
        ),
      ]);
      const directPriced = { route: direct.route, estimates: directEstimates };
      if (directEstimates.length === 0 && (safe?.priced.estimates.length ?? 0) === 0) {
        throw new AppError(503, "NY_NO_RIDES", "Namma Yatri has no rides for this trip right now. Try again in a minute, or try a demo ride.");
      }
      return safe ? { checkpoints: safe.checkpoints, safe: safe.priced, direct: directPriced } : { checkpoints: [], safe: directPriced };
    });
  };

  const pricedDemo = async ({ city, departAt }: StoredRoute, safeShape: readonly LngLat[]): Promise<PricedTrip> => {
    if (!hasMeterTariff(city.id)) throw new AppError(422, "RIDES_NOT_IN_CITY", `Ride booking isn't available in ${city.data.name} yet.`);
    const pickup = safeShape[0]!;
    const drop = safeShape.at(-1)!;
    const plan = await planCheckpoints(safeShape, (stops) => car.through([pickup, ...stops, drop]));
    const priced = (route: CandidateRoute): Priced => ({
      route,
      estimates: [
        {
          id: randomUUID(),
          tier: "Auto",
          fare: meterFare(city.id, route.distanceMeters, departAt, city.data.utcOffsetMinutes)!,
          pickupSeconds: SHOWN_PICKUP_SECONDS,
        },
      ],
    });
    return plan.checkpoints.length === 0
      ? { checkpoints: [], safe: priced(plan.route) }
      : { checkpoints: plan.checkpoints, safe: priced(plan.route), direct: priced(plan.direct) };
  };

  const findBooking = async (ride: LiveRecord, token: string) => {
    const since = ride.bookedAt.getTime() - BOOKING_CLOCK_SKEW_MS;
    const [booking] = (await hailing.recentBookings(token))
      .filter((b) => b.createdAt.getTime() >= since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (!booking) return;
    ride.bookingId = booking.id;
    ride.bookingStatus = booking.status;
    ride.rideId = booking.rideId;
    ride.rideStatus = booking.rideStatus;
    if (booking.driver) ride.driver = { ...ride.driver, ...booking.driver };
  };

  const trackRide = async (ride: LiveRecord, token: string, rideId: string) => {
    const progress = await hailing.rideProgress(token, rideId);
    ride.rideStatus = progress.status;
    ride.driver = { ...ride.driver, ...progress.driver };
    if (!progress.position) return;
    ride.position = progress.position;
    const last = ride.positions.at(-1);
    if (progress.status === "INPROGRESS" && (!last || haversineMeters(last, progress.position) > 1)) {
      ride.positions.push(progress.position);
      if (ride.positions.length > MAX_POSITIONS) ride.positions.shift();
    }
  };

  const liveStatus = (ride: LiveRecord, clock: number): RideStatus => {
    const { bookingStatus: booking, rideStatus: trip } = ride;
    if (ride.cancelledByRider) return "cancelled";
    if (trip === "COMPLETED" || booking === "COMPLETED") return "completed";
    if (trip === "INPROGRESS") return "riding";
    if (booking === "CANCELLED") return "cancelled";
    if (ride.rideId && (trip === "NEW" || trip === "UPCOMING")) return "assigned";
    if (!ride.bookingId && clock - ride.bookedAt.getTime() > NO_DRIVER_AFTER_MS) return "no_driver";
    return "searching";
  };

  const refresh = async (ride: LiveRecord, force = false) => {
    const clock = now().getTime();
    if (FINISHED.has(ride.status) || (!force && clock - ride.refreshedAt < LIVE_REFRESH_MS)) return;
    ride.refreshedAt = clock;
    try {
      await signedIn(ride.session, async (token) => {
        if (!ride.rideId || ride.rideStatus === "CANCELLED") await findBooking(ride, token);
        if (ride.rideId) await trackRide(ride, token, ride.rideId);
      });
      ride.stale = false;
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      ride.stale = true;
    }
    ride.status = liveStatus(ride, clock);
    if (ride.status === "no_driver") {
      await signedIn(ride.session, (token) => hailing.cancelSearch(token, ride.estimate.id)).catch(() => undefined);
    }
  };

  const view = (ride: RideRecord): RideView => {
    const clock = now();
    const areaAt = (position: LngLat | undefined) => (position ? ride.city.places.areaNear(position) : undefined);
    const base = {
      ref: ride.ref,
      mode: ride.mode,
      city: ride.city,
      route: ride.route.points,
      checkpoints: ride.checkpoints,
      tier: ride.estimate.tier,
      fare: ride.estimate.fare,
    };

    if (ride.mode === "demo") {
      const snapshot = demoSnapshot(ride.demo, clock);
      const recent = [2, 1, 0]
        .map((back) => demoSnapshot(ride.demo, new Date(clock.getTime() - back * GUARD_SAMPLE_MS)))
        .flatMap((s) => (s.status === "riding" && s.position ? [s.position] : []));
      return {
        ...base,
        status: snapshot.status,
        driver: snapshot.status === "searching" || snapshot.status === "cancelled" ? undefined : demoDriver(ride.city, ride.ref),
        position: snapshot.position,
        area: areaAt(snapshot.position),
        pickupSeconds: snapshot.pickupSeconds,
        guard: snapshot.status === "riding" ? guardRide(recent, ride.route) : undefined,
        reassigning: false,
        cancelledByRider: snapshot.status === "cancelled",
        stale: false,
        canCancel: CANCELLABLE.has(snapshot.status),
        cancelFee: false,
        canDetour: canDetour(ride.demo, clock),
      };
    }

    const { status, position, rideId } = ride;
    return {
      ...base,
      status,
      driver: ride.driver,
      position,
      area: areaAt(position),
      pickupSeconds:
        status === "assigned" && position ? Math.round(haversineMeters(position, ride.route.points[0]!) / PICKUP_METERS_PER_SECOND) : undefined,
      guard: status === "riding" ? guardRide(ride.positions, ride.route) : undefined,
      shareUrl: rideId && (status === "assigned" || status === "riding") ? hailing.shareUrl(rideId) : undefined,
      reassigning: status === "searching" && REASSIGNING_BOOKINGS.has(ride.bookingStatus ?? ""),
      cancelledByRider: ride.cancelledByRider,
      stale: ride.stale,
      canCancel: CANCELLABLE.has(status),
      cancelFee: status === "assigned",
      canDetour: false,
    };
  };

  const rideFor = (ref: string, session: string | undefined): RideRecord => {
    const ride = rides.get(ref);
    if (!ride || (ride.mode === "live" && ride.session !== session)) throw rideNotFound();
    return ride;
  };

  return {
    support,

    async link(code) {
      requireLive();
      const token = await hailing.signIn(code);
      const session = randomBytes(24).toString("base64url");
      sessions.set(session, token);
      return session;
    },

    isLinked: (session) => Boolean(session && sessions.get(session)),

    unlink(session) {
      if (session) sessions.delete(session);
    },

    async quote({ searchId, routeId, mode, session, weights, options }) {
      const stored = planner.route(searchId, routeId);
      const safeShape = shapeOf(stored.analysis);
      const safe = measurePath(safeShape);
      const trip = mode === "live" ? await pricedLive(stored, safeShape, session) : await pricedDemo(stored, safeShape);

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
          await signedIn(session, (token) => hailing.select(token, estimateId));
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
      if (ride.mode === "live") await refresh(ride);
      return view(ride);
    },

    async cancel(ref, session) {
      const ride = rideFor(ref, session);
      if (ride.mode === "demo") {
        if (!CANCELLABLE.has(demoSnapshot(ride.demo, now()).status)) throw cannotCancel();
        ride.demo = { ...ride.demo, cancelledAt: now() };
        return view(ride);
      }

      await refresh(ride, true);
      if (!CANCELLABLE.has(ride.status)) throw cannotCancel();
      const cancelBooking = (token: string, bookingId: string) =>
        hailing.cancelBooking(token, bookingId, DRIVER_ASSIGNED_BOOKINGS.has(ride.bookingStatus ?? ""));
      await signedIn(ride.session, async (token) => {
        if (ride.bookingId) return cancelBooking(token, ride.bookingId);
        try {
          await hailing.cancelSearch(token, ride.estimate.id);
        } catch (error) {
          if (!(error instanceof UpstreamError)) throw error;
          await findBooking(ride, token);
          if (!ride.bookingId) throw error;
          await cancelBooking(token, ride.bookingId);
        }
      });
      ride.cancelledByRider = true;
      ride.status = "cancelled";
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
