import type { CityIndex } from "#src/city/cityIndex.js";
import { haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { canDetour, demoSnapshot, type RideStatus } from "#src/rides/demoRide.js";
import { guardRide } from "#src/rides/guard.js";
import type { RideDriver } from "#src/planner/ports.js";
import type { RideRecord, RideView } from "#src/planner/rideTypes.js";

const GUARD_SAMPLE_MS = 2000;
const PICKUP_METERS_PER_SECOND = 5;
const REASSIGNING_BOOKINGS = new Set(["AWAITING_REASSIGNMENT", "REALLOCATED"]);
export const CANCELLABLE: ReadonlySet<RideStatus> = new Set(["searching", "assigned"]);

const demoDriver = (city: CityIndex, ref: string): RideDriver => ({
  name: "Demo driver",
  vehicleNumber: city.id === "pune" ? "MH 12 DEMO" : "KA 01 DEMO",
  vehicle: "Auto rickshaw",
  otp: String(parseInt(ref.slice(0, 4), 16) % 10_000).padStart(4, "0"),
});

export function viewRide(ride: RideRecord, clock: Date, shareUrlFor: (rideId: string) => string): RideView {
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
    shareUrl: rideId && (status === "assigned" || status === "riding") ? shareUrlFor(rideId) : undefined,
    reassigning: status === "searching" && REASSIGNING_BOOKINGS.has(ride.bookingStatus ?? ""),
    cancelledByRider: ride.cancelledByRider,
    stale: ride.stale,
    canCancel: CANCELLABLE.has(status),
    cancelFee: status === "assigned",
    canDetour: false,
  };
}
