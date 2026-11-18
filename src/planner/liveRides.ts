/**
 * Follows a live Namma Yatri ride. Namma Yatri creates the booking once a driver accepts, so
 * tracking matches the newest booking created after the selection (allowing BOOKING_CLOCK_SKEW_MS),
 * then follows its ride. No booking within NO_DRIVER_AFTER_MS ends the search. Driver positions
 * during the ride feed the route guard, judged against the route the ride was booked on.
 */
import { haversineMeters } from "#src/geo/geometry.js";
import { UpstreamError } from "#src/lib/http.js";
import type { RideStatus } from "#src/rides/demoRide.js";
import type { RideHailing } from "#src/planner/ports.js";
import type { RideSessions } from "#src/planner/rideSessions.js";
import type { LiveRecord } from "#src/planner/rideTypes.js";

const NO_DRIVER_AFTER_MS = 5 * 60_000;
const BOOKING_CLOCK_SKEW_MS = 2 * 60_000;
const LIVE_REFRESH_MS = 2500;
const MAX_POSITIONS = 20;
const FINISHED: ReadonlySet<RideStatus> = new Set(["completed", "cancelled", "no_driver"]);
const DRIVER_ASSIGNED_BOOKINGS = new Set(["TRIP_ASSIGNED", "CONFIRMED"]);

export interface LiveRides {
  refresh(ride: LiveRecord, force?: boolean): Promise<void>;
  cancel(ride: LiveRecord): Promise<void>;
}

export interface LiveRidesDeps {
  readonly hailing: RideHailing;
  readonly sessions: RideSessions;
  readonly now: () => Date;
}

function liveStatus(ride: LiveRecord, clock: number): RideStatus {
  const { bookingStatus: booking, rideStatus: trip } = ride;
  if (ride.cancelledByRider) return "cancelled";
  if (trip === "COMPLETED" || booking === "COMPLETED") return "completed";
  if (trip === "INPROGRESS") return "riding";
  if (booking === "CANCELLED") return "cancelled";
  if (ride.rideId && (trip === "NEW" || trip === "UPCOMING")) return "assigned";
  if (!ride.bookingId && clock - ride.bookedAt.getTime() > NO_DRIVER_AFTER_MS) return "no_driver";
  return "searching";
}

export function createLiveRides({ hailing, sessions, now }: LiveRidesDeps): LiveRides {
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

  const refresh = async (ride: LiveRecord, force = false) => {
    const clock = now().getTime();
    if (FINISHED.has(ride.status) || (!force && clock - ride.refreshedAt < LIVE_REFRESH_MS)) return;
    ride.refreshedAt = clock;
    try {
      await sessions.signedIn(ride.session, async (token) => {
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
      await sessions.signedIn(ride.session, (token) => hailing.cancelSearch(token, ride.estimate.id)).catch(() => undefined);
    }
  };

  return {
    refresh,

    async cancel(ride) {
      const cancelBooking = (token: string, bookingId: string) =>
        hailing.cancelBooking(token, bookingId, DRIVER_ASSIGNED_BOOKINGS.has(ride.bookingStatus ?? ""));
      await sessions.signedIn(ride.session, async (token) => {
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
    },
  };
}
