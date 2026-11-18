import type { RideScene } from "@/map/sceneLayers";
import { RIDE_POLL_MS, type RideBooking } from "@/state/useRideBooking";

export function rideSceneOf({ open, step, ride, quote, selectedOption }: RideBooking): RideScene | undefined {
  if (step === "ride" && ride) {
    return {
      key: `ride:${ride.ref}`,
      path: ride.route,
      checkpoints: ride.checkpoints.map((c) => c.point),
      ...(ride.position ? { driver: ride.position } : {}),
      offRoute: Boolean(ride.guard?.offRoute),
      tweenMs: RIDE_POLL_MS[ride.mode],
    };
  }
  if (!open || step !== "compare" || !quote || !selectedOption) return undefined;
  const other = quote.options.find((o) => o.kind !== selectedOption.kind);
  return {
    key: `quote:${quote.quoteId}:${selectedOption.kind}`,
    path: selectedOption.path,
    ...(other ? { alternative: other.path } : {}),
    checkpoints: selectedOption.kind === "safe" ? quote.checkpoints.map((c) => c.point) : [],
    offRoute: false,
    tweenMs: RIDE_POLL_MS.demo,
  };
}
