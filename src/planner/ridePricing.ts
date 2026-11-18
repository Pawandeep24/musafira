/**
 * Fares for a ride quote. Live: Namma Yatri's route with no stops → safety checkpoints where it
 * strays from the safe route (planCheckpoints; Valhalla's car profile routes the trial stops) →
 * Namma Yatri's route and fares through the checkpoints. Demo uses Valhalla car routes for both
 * and the city's meter tariff. When Namma Yatri can't price the checkpoints, the safe option
 * comes back without fares and its usual route stays bookable.
 */
import { randomUUID } from "node:crypto";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { LngLat } from "#src/geo/geometry.js";
import { measurePath } from "#src/geo/path.js";
import { AppError } from "#src/lib/errors.js";
import { planCheckpoints, type Checkpoint } from "#src/rides/checkpoints.js";
import { hasMeterTariff, meterFare, SHOWN_PICKUP_SECONDS } from "#src/rides/demoRide.js";
import type { CandidateRoute } from "#src/safety/types.js";
import type { CarRouter, RideEstimate, RideHailing, RideSearch, StoredRoute } from "#src/planner/ports.js";
import type { NamedPoint } from "#src/planner/rideTypes.js";

const CITY_CAR_METERS_PER_SECOND = 6;

export interface Priced {
  readonly route: CandidateRoute;
  readonly estimates: readonly RideEstimate[];
}

export interface PricedTrip {
  readonly checkpoints: readonly Checkpoint[];
  readonly safe: Priced;
  readonly direct?: Priced;
}

export const namer = (city: CityIndex) => (point: LngLat): NamedPoint => {
  const name = city.places.areaNear(point);
  return name ? { point, name } : { point };
};

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

export async function priceLive(
  hailing: RideHailing,
  car: CarRouter,
  token: string,
  city: CityIndex,
  safeShape: readonly LngLat[],
): Promise<PricedTrip> {
  const name = namer(city);
  const pickup = safeShape[0]!;
  const drop = safeShape.at(-1)!;

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
}

export async function priceDemo(car: CarRouter, { city, departAt }: StoredRoute, safeShape: readonly LngLat[]): Promise<PricedTrip> {
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
}
