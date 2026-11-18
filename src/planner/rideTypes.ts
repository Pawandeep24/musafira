import type { CityIndex } from "#src/city/cityIndex.js";
import type { LngLat } from "#src/geo/geometry.js";
import type { MeasuredPath } from "#src/geo/path.js";
import type { DemoRide, RideStatus } from "#src/rides/demoRide.js";
import type { GuardState } from "#src/rides/guard.js";
import type { RideDriver, RideEstimate } from "#src/planner/ports.js";

export type RideMode = "live" | "demo";

export interface NamedPoint {
  readonly point: LngLat;
  readonly name?: string;
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

export interface RideBase {
  readonly ref: string;
  readonly city: CityIndex;
  readonly route: MeasuredPath;
  readonly checkpoints: readonly NamedPoint[];
  readonly estimate: RideEstimate;
  readonly bookedAt: Date;
}

export interface DemoRecord extends RideBase {
  readonly mode: "demo";
  demo: DemoRide;
}

export interface LiveRecord extends RideBase {
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

export type RideRecord = DemoRecord | LiveRecord;
