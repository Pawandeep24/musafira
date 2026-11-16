import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth/tokenVerifier.js";
import type { CityIndex } from "../src/city/cityIndex.js";
import { createCityRegistry } from "../src/city/cityRegistry.js";
import { loadEnv } from "../src/config/env.js";
import type { LngLat } from "../src/geo/geometry.js";
import { measurePath } from "../src/geo/path.js";
import { AppError, unauthorized } from "../src/lib/errors.js";
import { UpstreamError } from "../src/lib/http.js";
import type { CarRouter, RideBookingInfo, RideHailing, RideProgress, RouteProvider } from "../src/planner/ports.js";
import { createRideBooking } from "../src/planner/rideBooking.js";
import { createRoutePlanner } from "../src/planner/routePlanner.js";
import type { CandidateRoute } from "../src/safety/types.js";
import { NIGHT, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, straightRoute, testCity } from "./fixtures.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const verifier: TokenVerifier = { verify: async () => Promise.reject(unauthorized()) };
const from = [ROUTE_WEST, ROUTE_LAT];
const to = [ROUTE_EAST, ROUTE_LAT];
const safeShape = straightRoute().shape;
const north = (meters: number) => ROUTE_LAT + meters / 111_320;
const bypass: LngLat[] = [
  [ROUTE_WEST, ROUTE_LAT],
  [73.81, ROUTE_LAT],
  [73.81, north(550)],
  [73.83, north(550)],
  [73.83, ROUTE_LAT],
  [ROUTE_EAST, ROUTE_LAT],
];

function carRoute(shape: readonly LngLat[]): CandidateRoute {
  const path = measurePath(shape);
  return { shape, secondsAt: path.cumulative.map((m) => m / 8), distanceMeters: path.totalMeters, durationSeconds: path.totalMeters / 8, roads: [] };
}

function fakeNammaYatri() {
  let searches = 0;
  const state: { bookings: RideBookingInfo[]; progress?: RideProgress } = { bookings: [] };
  const hailing = {
    signIn: vi.fn(async (code: string) => {
      if (code !== "4321") throw new AppError(401, "NY_CODE_INVALID", "That code didn't work.");
      return "ny-token";
    }),
    search: vi.fn(async (_token: string, trip: Parameters<RideHailing["search"]>[1]) => {
      const shape = trip.stops.length > 0 ? safeShape : bypass;
      return { searchId: `search-${++searches}`, route: { points: shape, durationSeconds: 600 } };
    }),
    estimates: vi.fn(async (_token: string, searchId: string) => [
      { id: `${searchId}-auto`, tier: "Auto", fare: searchId === "search-1" ? 110 : 125, minFare: 100, maxFare: 140, pickupSeconds: 180 },
    ]),
    select: vi.fn(async () => undefined),
    recentBookings: vi.fn(async () => state.bookings),
    rideProgress: vi.fn(async () => state.progress!),
    cancelSearch: vi.fn(async () => undefined),
    cancelBooking: vi.fn(async () => undefined),
    shareUrl: (rideId: string) => `https://share.test/${rideId}`,
  } satisfies RideHailing;
  return { hailing, state };
}

async function setup(city: CityIndex = testCity({ id: "bengaluru", name: "Bengaluru" }), live = true) {
  let clock = NIGHT;
  const now = () => clock;
  const cities = createCityRegistry([city, testCity({ id: "pune", name: "Pune", bbox: { west: 0, south: 0, east: 1, north: 1 } })]);
  const routing: RouteProvider = { routes: async () => [straightRoute()] };
  const planner = createRoutePlanner({ cities, routing, now });
  const car: CarRouter = {
    through: vi.fn(async (points: readonly LngLat[]) => carRoute(points.length > 2 ? safeShape : bypass)),
    roadsAlong: vi.fn(async (shape: readonly LngLat[]) => [{ endMeters: measurePath(shape).totalMeters, roadClass: "primary", tunnel: false }]),
  };
  const { hailing, state } = fakeNammaYatri();
  const rides = createRideBooking({ planner, car, hailing, live, now });
  const app = await buildApp({ env, verifier, cities, planner, rides, now });

  const plan = async (departAt?: Date) =>
    (await app.inject({ method: "POST", url: "/api/plan", payload: { from, to, ...(departAt ? { departAt: departAt.toISOString() } : {}) } })).json();
  const link = async () => (await app.inject({ method: "POST", url: "/api/rides/link", payload: { code: "4321" } })).json().session as string;
  const quote = async (mode: "live" | "demo", session?: string, departAt?: Date) => {
    const { searchId, routes } = await plan(departAt);
    return app.inject({
      method: "POST",
      url: "/api/rides/quote",
      headers: session ? { "x-ny-session": session } : {},
      payload: { searchId, routeId: routes[0].id, mode },
    });
  };
  const advance = (seconds: number) => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  return { app, car, hailing, state, link, quote, advance, now };
}

describe("ride booking API", () => {
  it("tells the client which cities can book live and which only demo", async () => {
    const { app } = await setup();
    const { cities } = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(Object.fromEntries(cities.map((c: { id: string; rides: unknown }) => [c.id, c.rides]))).toEqual({
      bengaluru: { live: true, demo: true },
      pune: { live: false, demo: true },
    });
  });

  it("offers only demo rides while live booking is off", async () => {
    const { app, quote, hailing } = await setup(undefined, false);
    const { cities } = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(cities.map((c: { rides: { live: boolean; demo: boolean } }) => c.rides)).toEqual([
      { live: false, demo: true },
      { live: false, demo: true },
    ]);
    expect((await app.inject({ method: "POST", url: "/api/rides/link", payload: { code: "4321" } })).json().error.code).toBe("LIVE_OFF");
    expect((await quote("live")).json().error.code).toBe("LIVE_OFF");
    expect((await quote("demo")).statusCode).toBe(200);
    expect(hailing.signIn).not.toHaveBeenCalled();
  });

  it("quotes a demo ride with safety checkpoints and meter fares, contacting no one", async () => {
    const { quote, hailing } = await setup(testCity({ id: "pune", name: "Pune" }));
    const res = await quote("demo");
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.mode).toBe("demo");
    expect(body.checkpoints).toHaveLength(1);
    const [safe, direct] = body.options;
    expect([safe.kind, direct.kind]).toEqual(["safe", "direct"]);
    expect(safe.coverage).toBeGreaterThan(direct.coverage);
    expect(safe.estimates[0]).toMatchObject({ tier: "Auto", fare: expect.any(Number) });
    expect(direct.estimates[0].fare).toBeGreaterThan(safe.estimates[0].fare);
    expect(hailing.search).not.toHaveBeenCalled();
  });

  it("runs a demo ride from booking to drop, with a wrong turn the guard catches", async () => {
    const { app, quote, advance } = await setup(testCity({ id: "pune", name: "Pune" }));
    const { quoteId, options } = (await quote("demo")).json();
    const booked = await app.inject({ method: "POST", url: "/api/rides", payload: { quoteId, estimateId: options[0].estimates[0].id } });
    expect(booked.statusCode).toBe(201);
    const { ref } = booked.json();
    const status = async () => (await app.inject({ method: "GET", url: `/api/rides/${ref}` })).json();

    expect((await status()).status).toBe("searching");
    advance(6);
    expect(await status()).toMatchObject({ status: "assigned", driver: { otp: expect.stringMatching(/^\d{4}$/) }, canCancel: true });
    advance(8);
    const riding = await status();
    expect(riding).toMatchObject({ status: "riding", canCancel: false, canDetour: true, guard: { offRoute: false } });

    expect((await app.inject({ method: "POST", url: `/api/rides/${ref}/detour` })).statusCode).toBe(200);
    advance(10);
    expect((await status()).guard).toMatchObject({ offRoute: true });
    expect((await app.inject({ method: "POST", url: `/api/rides/${ref}/cancel` })).json().error.code).toBe("CANNOT_CANCEL");
    advance(120);
    expect((await status()).status).toBe("completed");
  });

  it("books a quote only once", async () => {
    const { app, quote } = await setup(testCity({ id: "pune", name: "Pune" }));
    const { quoteId, options } = (await quote("demo")).json();
    const payload = { quoteId, estimateId: options[0].estimates[0].id };
    expect((await app.inject({ method: "POST", url: "/api/rides", payload })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/rides", payload })).json().error.code).toBe("QUOTE_EXPIRED");
  });

  it("links a Namma Yatri account with an app code, and unlinks it", async () => {
    const { app, hailing } = await setup();
    const wrong = await app.inject({ method: "POST", url: "/api/rides/link", payload: { code: "1111" } });
    expect(wrong.json().error.code).toBe("NY_CODE_INVALID");
    expect((await app.inject({ method: "POST", url: "/api/rides/link", payload: { code: "abc" } })).statusCode).toBe(400);

    const res = await app.inject({ method: "POST", url: "/api/rides/link", payload: { code: " 4321 " } });
    const { session } = res.json();
    expect(session).toMatch(/^[\w-]{20,}$/);
    expect(res.body).not.toContain("ny-token");
    expect(hailing.signIn).toHaveBeenLastCalledWith("4321");
    const linked = async () => (await app.inject({ method: "GET", url: "/api/rides/link", headers: { "x-ny-session": session } })).json().linked;
    expect(await linked()).toBe(true);
    await app.inject({ method: "DELETE", url: "/api/rides/link", headers: { "x-ny-session": session } });
    expect(await linked()).toBe(false);
  });

  it("refuses live rides without a linked account, outside Bengaluru, or for a later departure", async () => {
    const { quote, link, now } = await setup();
    expect((await quote("live")).json().error.code).toBe("NY_SIGNED_OUT");
    const session = await link();
    const later = new Date(now().getTime() + 2 * 60 * 60_000);
    expect((await quote("live", session, later)).json().error.code).toBe("LIVE_NOT_NOW");

    const pune = await setup(testCity({ id: "pune", name: "Pune" }));
    expect((await pune.quote("live", await pune.link())).json().error.code).toBe("NY_NOT_IN_CITY");
  });

  it("prices Namma Yatri's usual route and the route through the checkpoints", async () => {
    const { quote, link, hailing } = await setup();
    const res = await quote("live", await link());
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(hailing.search).toHaveBeenCalledTimes(2);
    expect(hailing.search.mock.calls[0]![1].stops).toEqual([]);
    expect(hailing.search.mock.calls[1]![1].stops).toHaveLength(1);
    expect(hailing.search.mock.calls[0]![0]).toBe("ny-token");
    const [safe, direct] = body.options;
    expect(safe).toMatchObject({ kind: "safe", estimates: [{ id: "search-2-auto", fare: 125 }] });
    expect(direct).toMatchObject({ kind: "direct", estimates: [{ id: "search-1-auto", fare: 110 }] });
    expect(safe.coverage).toBeGreaterThan(0.9);
    expect(direct.coverage).toBeLessThan(0.6);
    expect(res.body).not.toContain("ny-token");
  });

  it("asks drivers only after an explicit confirmation", async () => {
    const { app, quote, link, hailing } = await setup();
    const session = await link();
    const { quoteId, options } = (await quote("live", session)).json();
    const book = (confirm?: boolean) =>
      app.inject({
        method: "POST",
        url: "/api/rides",
        headers: { "x-ny-session": session },
        payload: { quoteId, estimateId: options[0].estimates[0].id, ...(confirm === undefined ? {} : { confirm }) },
      });

    expect((await book()).json().error.code).toBe("CONFIRM_REQUIRED");
    expect(hailing.select).not.toHaveBeenCalled();
    const res = await book(true);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mode: "live", status: "searching", canCancel: true, cancelFee: false });
    expect(hailing.select).toHaveBeenCalledWith("ny-token", "search-2-auto");
  });

  async function liveRide() {
    const ctx = await setup();
    const session = await ctx.link();
    const { quoteId, options } = (await ctx.quote("live", session)).json();
    const headers = { "x-ny-session": session };
    const { ref } = (
      await ctx.app.inject({ method: "POST", url: "/api/rides", headers, payload: { quoteId, estimateId: options[0].estimates[0].id, confirm: true } })
    ).json();
    const status = async (seconds = 3) => {
      ctx.advance(seconds);
      return (await ctx.app.inject({ method: "GET", url: `/api/rides/${ref}`, headers })).json();
    };
    const cancel = async () => (await ctx.app.inject({ method: "POST", url: `/api/rides/${ref}/cancel`, headers })).json();
    const driver = { name: "Manju", vehicleNumber: "KA01AB1234", otp: "4821" };
    const assign = () => {
      ctx.state.bookings = [
        { id: "booking-1", status: "TRIP_ASSIGNED", createdAt: ctx.now(), rideId: "ride-1", rideStatus: "NEW", driver },
      ];
      ctx.state.progress = { status: "NEW", driver, position: [ROUTE_WEST - 0.004, ROUTE_LAT] };
    };
    return { ...ctx, ref, session, status, cancel, assign };
  }

  it("follows a live ride from driver assignment to drop, alerting when it leaves the route", async () => {
    const { status, assign, state, ref, app } = await liveRide();
    expect((await status()).status).toBe("searching");

    assign();
    const assigned = await status();
    expect(assigned).toMatchObject({
      status: "assigned",
      driver: { name: "Manju", otp: "4821" },
      shareUrl: "https://share.test/ride-1",
      cancelFee: true,
      pickupSeconds: expect.any(Number),
    });

    state.progress = { status: "INPROGRESS", driver: {}, position: [73.81, ROUTE_LAT] };
    expect(await status()).toMatchObject({ status: "riding", guard: { offRoute: false }, canCancel: false });
    for (const lon of [73.812, 73.813, 73.814]) {
      state.progress = { status: "INPROGRESS", driver: {}, position: [lon, north(300)] };
      await status();
    }
    expect((await status(3)).guard).toMatchObject({ offRoute: true, metersOff: expect.any(Number) });

    state.progress = { status: "COMPLETED", driver: {}, position: [ROUTE_EAST, ROUTE_LAT] };
    expect((await status()).status).toBe("completed");
    expect((await app.inject({ method: "GET", url: `/api/rides/${ref}` })).statusCode).toBe(404);
  });

  it("cancels the driver search before anyone accepts", async () => {
    const { cancel, hailing } = await liveRide();
    expect(await cancel()).toMatchObject({ status: "cancelled", cancelledByRider: true });
    expect(hailing.cancelSearch).toHaveBeenCalledWith("ny-token", "search-2-auto");
    expect(hailing.cancelBooking).not.toHaveBeenCalled();
  });

  it("cancels an assigned booking at the driver-assigned stage", async () => {
    const { cancel, assign, hailing } = await liveRide();
    assign();
    expect((await cancel()).status).toBe("cancelled");
    expect(hailing.cancelBooking).toHaveBeenCalledWith("ny-token", "booking-1", true);
  });

  it("ends the search, and stops Namma Yatri's, when no driver accepts in time", async () => {
    const { status, hailing } = await liveRide();
    expect((await status(6 * 60)).status).toBe("no_driver");
    expect(hailing.cancelSearch).toHaveBeenCalledOnce();
  });

  it("keeps the last state through a Namma Yatri outage", async () => {
    const { status, assign, hailing } = await liveRide();
    assign();
    expect((await status()).status).toBe("assigned");
    hailing.rideProgress.mockRejectedValueOnce(new UpstreamError("Namma Yatri", 503));
    expect(await status()).toMatchObject({ status: "assigned", stale: true });
    expect(await status()).toMatchObject({ status: "assigned", stale: false });
  });

  it("forgets the account when Namma Yatri ends the sign-in", async () => {
    const { status, app, session, assign, hailing } = await liveRide();
    assign();
    hailing.rideProgress.mockRejectedValueOnce(new AppError(401, "NY_SIGNED_OUT", "Sign-in ended"));
    expect((await status()).error.code).toBe("NY_SIGNED_OUT");
    const linked = await app.inject({ method: "GET", url: "/api/rides/link", headers: { "x-ny-session": session } });
    expect(linked.json().linked).toBe(false);
  });
});
