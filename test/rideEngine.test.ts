import { describe, expect, it } from "vitest";
import { distanceToPathMeters, haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { measurePath } from "#src/geo/path.js";
import { planCheckpoints, type RoutedPath } from "#src/rides/checkpoints.js";
import { canDetour, demoSnapshot, meterFare } from "#src/rides/demoRide.js";
import { guardRide } from "#src/rides/guard.js";
import { MIDDLE_LON, NIGHT, NOON, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, straightRoute } from "#test/fixtures.js";

const safeShape = straightRoute().shape;
const north = (lat: number, meters: number) => lat + meters / 111_320;

/** Leaves the safe route between two longitudes and runs parallel `meters` to the north. */
function bypass(fromLon: number, toLon: number, meters = 550): LngLat[] {
  const lat = north(ROUTE_LAT, meters);
  return [
    [ROUTE_WEST, ROUTE_LAT],
    [fromLon, ROUTE_LAT],
    [fromLon, lat],
    [toLon, lat],
    [toLon, ROUTE_LAT],
    [ROUTE_EAST, ROUTE_LAT],
  ];
}

const routed = (shape: readonly LngLat[]): RoutedPath => ({ shape, distanceMeters: measurePath(shape).totalMeters });

describe("safety checkpoints", () => {
  it("adds one checkpoint in the stretch the car route skips, and stops once the route follows", async () => {
    const calls: (readonly LngLat[])[] = [];
    const plan = await planCheckpoints(safeShape, async (stops) => {
      calls.push(stops);
      return routed(stops.length === 0 ? bypass(73.81, 73.83) : safeShape);
    });

    expect(plan.checkpoints).toHaveLength(1);
    expect(plan.checkpoints[0]!.point[0]).toBeCloseTo(MIDDLE_LON, 2);
    expect(distanceToPathMeters(plan.checkpoints[0]!.point, safeShape)).toBeLessThan(5);
    expect(plan.directCoverage).toBeLessThan(0.6);
    expect(plan.coverage).toBeGreaterThan(0.95);
    expect(calls).toHaveLength(2);
  });

  it("needs no checkpoint when the car route already follows the safe route", async () => {
    const plan = await planCheckpoints(safeShape, async () => routed(safeShape));
    expect(plan.checkpoints).toEqual([]);
    expect(plan.coverage).toBe(1);
  });

  it("ignores a detour right at pickup, which the pickup point already pins", async () => {
    const plan = await planCheckpoints(safeShape, async () => routed(bypass(ROUTE_WEST, ROUTE_WEST + 0.0015, 80)));
    expect(plan.checkpoints).toEqual([]);
  });

  it("keeps the direct route when a checkpoint would make the ride far longer", async () => {
    const loop = bypass(73.81, 73.83, 3000);
    const plan = await planCheckpoints(safeShape, async (stops) => routed(stops.length === 0 ? bypass(73.81, 73.83) : loop));
    expect(plan.checkpoints).toEqual([]);
    expect(plan.route.shape).toEqual(plan.direct.shape);
  });

  it("keeps the best set so far when routing through a checkpoint fails", async () => {
    const plan = await planCheckpoints(safeShape, async (stops) => {
      if (stops.length > 0) throw new Error("no route");
      return routed(bypass(73.81, 73.83));
    });
    expect(plan.checkpoints).toEqual([]);
  });
});

describe("route guard", () => {
  const route = measurePath(safeShape);
  const onRoute = (lon: number): LngLat => [lon, ROUTE_LAT];
  const offRoute = (lon: number): LngLat => [lon, north(ROUTE_LAT, 300)];

  it("tracks progress while the ride stays on route", () => {
    const state = guardRide([onRoute(73.805), onRoute(73.81), onRoute(MIDDLE_LON)], route)!;
    expect(state.offRoute).toBe(false);
    expect(state.progress).toBeCloseTo(0.5, 1);
  });

  it("raises an alert after three positions in a row far from the route", () => {
    const state = guardRide([onRoute(73.81), offRoute(73.815), offRoute(73.816), offRoute(73.817)], route)!;
    expect(state.offRoute).toBe(true);
    expect(state.metersOff).toBeGreaterThan(250);
  });

  it("does not alert on a single GPS jump or with too few positions", () => {
    expect(guardRide([offRoute(73.815), onRoute(73.816), offRoute(73.817)], route)!.offRoute).toBe(false);
    expect(guardRide([offRoute(73.815), offRoute(73.816)], route)!.offRoute).toBe(false);
    expect(guardRide([], route)).toBeUndefined();
  });
});

describe("demo rides", () => {
  it("prices autos on the city's meter tariff, with its night rate in city time", () => {
    expect(meterFare("bengaluru", 5000, NOON, 330)).toBe(90);
    expect(meterFare("bengaluru", 5000, NIGHT, 330)).toBe(135);
    expect(meterFare("pune", 5000, NIGHT, 330)).toBe(100);
    expect(meterFare("pune", 5000, new Date("2026-11-14T19:30:00Z"), 330)).toBe(125);
    expect(meterFare("bengaluru", 1000, NOON, 330)).toBe(36);
    expect(meterFare("testville", 5000, NOON, 330)).toBeUndefined();
  });

  it("finds a driver, approaches the pickup, rides the route and completes", () => {
    const bookedAt = NOON;
    const ride = { bookedAt, route: measurePath(safeShape) };
    const at = (seconds: number) => demoSnapshot(ride, new Date(bookedAt.getTime() + seconds * 1000));

    expect(at(1).status).toBe("searching");
    const assigned = at(6);
    expect(assigned.status).toBe("assigned");
    expect(assigned.pickupSeconds).toBeGreaterThan(0);
    expect(assigned.position![0]).toBeLessThan(ROUTE_WEST);
    const riding = at(30);
    expect(riding.status).toBe("riding");
    expect(distanceToPathMeters(riding.position!, safeShape)).toBeLessThan(1);
    expect(at(600)).toMatchObject({ status: "completed", position: safeShape.at(-1) });
  });

  it("takes a simulated wrong turn away from the route and back", () => {
    const bookedAt = NOON;
    const base = { bookedAt, route: measurePath(safeShape) };
    const time = (seconds: number) => new Date(bookedAt.getTime() + seconds * 1000);

    expect(canDetour(base, time(1))).toBe(false);
    expect(canDetour(base, time(14))).toBe(true);
    const ride = { ...base, detourAt: time(14) };
    expect(canDetour(ride, time(20))).toBe(false);
    expect(distanceToPathMeters(demoSnapshot(ride, time(24)).position!, safeShape)).toBeGreaterThan(400);
    expect(distanceToPathMeters(demoSnapshot(ride, time(35)).position!, safeShape)).toBeLessThan(1);
    expect(demoSnapshot({ ...base, cancelledAt: time(3) }, time(5)).status).toBe("cancelled");
    expect(haversineMeters(demoSnapshot(ride, time(14)).position!, demoSnapshot(base, time(14)).position!)).toBeLessThan(1);
  });
});
