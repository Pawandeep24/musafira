/**
 * Demo mode: a ride that behaves like a real one without contacting anyone.
 *
 * Fares are the city's government auto-rickshaw meter tariff, shown as estimates:
 *   fare = baseFare + perKm × max(0, km − baseKm), × multiplier inside the night window (city time)
 *   Bengaluru: RTA Bengaluru Urban, from 1 Aug 2025: ₹36 for 2 km, ₹18/km, 1.5× from 22:00 to 05:00
 *   Pune:      RTO Pune, from 1 Sep 2026: ₹30 for 1.5 km, ₹20/km, +25% from 00:00 to 05:00
 *
 * The simulated driver runs on a compressed clock so a whole ride fits in about two minutes:
 * SEARCH_SECONDS finding a driver, ARRIVAL_SECONDS approaching the pickup along the road the
 * route starts on (the shown ETA counts down from SHOWN_PICKUP_SECONDS), then the ride at
 * DEMO_METERS_PER_SECOND, bounded to MIN/MAX_RIDE_SECONDS. A wrong turn pushes the driver
 * sideways off the route, peaking at DETOUR_PEAK_METERS halfway through DETOUR_SECONDS and
 * coming back, which is long enough for the route guard's consecutive-position rule.
 */
import type { LngLat } from "#src/geo/geometry.js";
import type { MeasuredPath } from "#src/geo/path.js";

const SEARCH_SECONDS = 4;
const ARRIVAL_SECONDS = 8;
export const SHOWN_PICKUP_SECONDS = 240;
const APPROACH_METERS = 500;
const DEMO_METERS_PER_SECOND = 80;
const MIN_RIDE_SECONDS = 45;
const MAX_RIDE_SECONDS = 150;
const DETOUR_SECONDS = 20;
const DETOUR_PEAK_METERS = 450;
const METERS_PER_DEGREE = 111_320;

interface Tariff {
  readonly baseFare: number;
  readonly baseKm: number;
  readonly perKm: number;
  readonly night: { readonly fromHour: number; readonly toHour: number; readonly multiplier: number };
}

const AUTO_TARIFFS: Readonly<Record<string, Tariff>> = {
  bengaluru: { baseFare: 36, baseKm: 2, perKm: 18, night: { fromHour: 22, toHour: 5, multiplier: 1.5 } },
  pune: { baseFare: 30, baseKm: 1.5, perKm: 20, night: { fromHour: 0, toHour: 5, multiplier: 1.25 } },
};

export const hasMeterTariff = (cityId: string): boolean => cityId in AUTO_TARIFFS;

/** Meter fare in rupees for an auto ride starting at `at`, or undefined for a city without a tariff. */
export function meterFare(cityId: string, distanceMeters: number, at: Date, utcOffsetMinutes: number): number | undefined {
  const tariff = AUTO_TARIFFS[cityId];
  if (!tariff) return undefined;
  const km = distanceMeters / 1000;
  const day = tariff.baseFare + tariff.perKm * Math.max(0, km - tariff.baseKm);
  const hour = (((at.getTime() / 60_000 + utcOffsetMinutes) / 60) % 24 + 24) % 24;
  const { fromHour, toHour, multiplier } = tariff.night;
  const night = fromHour <= toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
  return Math.round(night ? day * multiplier : day);
}

export type RideStatus = "searching" | "assigned" | "riding" | "completed" | "cancelled" | "no_driver";

export interface DemoRide {
  readonly bookedAt: Date;
  readonly route: MeasuredPath;
  readonly detourAt?: Date;
  readonly cancelledAt?: Date;
}

export interface DemoSnapshot {
  readonly status: RideStatus;
  readonly position?: LngLat;
  readonly pickupSeconds?: number;
}

function offset([lon, lat]: LngLat, eastMeters: number, northMeters: number): LngLat {
  return [lon + eastMeters / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180)), lat + northMeters / METERS_PER_DEGREE];
}

/** Unit vector (east, north) of the route's direction around `alongMeters`. */
function heading(route: MeasuredPath, alongMeters: number): readonly [number, number] {
  const [lon1, lat1] = route.pointAt(Math.max(0, alongMeters - 15));
  const [lon2, lat2] = route.pointAt(Math.min(route.totalMeters, alongMeters + 15));
  const east = (lon2 - lon1) * METERS_PER_DEGREE * Math.cos((lat1 * Math.PI) / 180);
  const north = (lat2 - lat1) * METERS_PER_DEGREE;
  const length = Math.hypot(east, north) || 1;
  return [east / length, north / length];
}

function rideSeconds(route: MeasuredPath): number {
  return Math.min(MAX_RIDE_SECONDS, Math.max(MIN_RIDE_SECONDS, route.totalMeters / DEMO_METERS_PER_SECOND));
}

export function demoSnapshot(ride: DemoRide, now: Date): DemoSnapshot {
  if (ride.cancelledAt) return { status: "cancelled" };
  const elapsed = (now.getTime() - ride.bookedAt.getTime()) / 1000;
  if (elapsed < SEARCH_SECONDS) return { status: "searching" };

  const pickup = ride.route.pointAt(0);
  if (elapsed < SEARCH_SECONDS + ARRIVAL_SECONDS) {
    const share = (elapsed - SEARCH_SECONDS) / ARRIVAL_SECONDS;
    const [east, north] = heading(ride.route, 0);
    const remaining = APPROACH_METERS * (1 - share);
    return {
      status: "assigned",
      position: offset(pickup, -east * remaining, -north * remaining),
      pickupSeconds: Math.round(SHOWN_PICKUP_SECONDS * (1 - share)),
    };
  }

  const riding = elapsed - SEARCH_SECONDS - ARRIVAL_SECONDS;
  const duration = rideSeconds(ride.route);
  if (riding >= duration) return { status: "completed", position: ride.route.pointAt(ride.route.totalMeters) };

  const along = (riding / duration) * ride.route.totalMeters;
  const onRoute = ride.route.pointAt(along);
  const detour = ride.detourAt ? (now.getTime() - ride.detourAt.getTime()) / 1000 : -1;
  if (detour < 0 || detour > DETOUR_SECONDS) return { status: "riding", position: onRoute };
  const [east, north] = heading(ride.route, along);
  const sideways = DETOUR_PEAK_METERS * Math.sin((Math.PI * detour) / DETOUR_SECONDS);
  return { status: "riding", position: offset(onRoute, north * sideways, -east * sideways) };
}

/** Whether a wrong turn can start now: during the ride, not already detouring, with time left to come back. */
export function canDetour(ride: DemoRide, now: Date): boolean {
  if (demoSnapshot(ride, now).status !== "riding") return false;
  if (ride.detourAt && (now.getTime() - ride.detourAt.getTime()) / 1000 <= DETOUR_SECONDS) return false;
  const riding = (now.getTime() - ride.bookedAt.getTime()) / 1000 - SEARCH_SECONDS - ARRIVAL_SECONDS;
  return rideSeconds(ride.route) - riding > DETOUR_SECONDS;
}
