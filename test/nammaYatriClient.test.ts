import { describe, expect, it, vi } from "vitest";
import { NammaYatriClient } from "../src/integrations/nammayatri/client.js";
import { AppError } from "../src/lib/errors.js";
import { UpstreamError } from "../src/lib/http.js";

const BASE = "https://ny.test/app/v2";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const nyError = (errorCode: string, errorMessage: string, status = 400) => json({ errorCode, errorMessage }, status);

type Handler = (path: string, init: RequestInit) => Response;

function client(handler: Handler) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url).slice(BASE.length), init ?? {}));
  return { ny: new NammaYatriClient({ baseUrl: `${BASE}/`, fetchImpl, pollIntervalMs: 0, pollTimeoutMs: 1000 }), fetchImpl };
}

const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);
const headerOf = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("Namma Yatri client", () => {
  it("redeems an app code for the rider's token", async () => {
    const { ny, fetchImpl } = client(() => json({ token: "rider-token" }));
    await expect(ny.signIn("4031")).resolves.toBe("rider-token");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/auth/get-token`);
    expect(bodyOf(init!)).toEqual({ appSecretCode: "4031" });
  });

  it("explains an expired code and Namma Yatri's attempt limit", async () => {
    const expired = client(() => nyError("GET_USER_ID_ERROR", "Invalid app secret code"));
    await expect(expired.ny.signIn("1")).rejects.toMatchObject({ statusCode: 401, code: "NY_CODE_INVALID" });
    const limited = client(() => nyError("INVALID_REQUEST", "Too many attempts"));
    await expect(limited.ny.signIn("1")).rejects.toMatchObject({ statusCode: 429, code: "NY_CODE_LIMIT" });
    const otherFailure = client(() => nyError("INVALID_REQUEST", "Something else"));
    await expect(otherFailure.ny.signIn("1")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("searches with stops in order and returns Namma Yatri's planned route", async () => {
    const { ny, fetchImpl } = client(() =>
      json({
        searchId: "search-1",
        routeInfo: { points: [{ lat: 12.97, lon: 77.62 }, { lat: 12.98, lon: 77.63 }], distance: 1800, duration: 420 },
      }),
    );
    const search = await ny.search("rider-token", {
      pickup: { point: [77.62, 12.97], name: "Halasuru" },
      stops: [{ point: [77.622, 12.985] }],
      drop: { point: [77.63, 12.98], name: "Indiranagar" },
      cityName: "Bengaluru",
    });

    expect(search).toEqual({
      searchId: "search-1",
      route: { points: [[77.62, 12.97], [77.63, 12.98]], distanceMeters: 1800, durationSeconds: 420 },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/rideSearch`);
    expect(String(url)).not.toContain("rider-token");
    expect(headerOf(init!, "token")).toBe("rider-token");
    const body = bodyOf(init!);
    expect(body.fareProductType).toBe("ONE_WAY");
    expect(body.contents.origin).toMatchObject({ gps: { lat: 12.97, lon: 77.62 }, address: { area: "Halasuru", city: "Bengaluru" } });
    expect(body.contents.stops).toHaveLength(1);
    expect(body.contents.stops[0].gps).toEqual({ lat: 12.985, lon: 77.622 });
  });

  it("polls for fares until they stop arriving and skips malformed ones", async () => {
    const estimate = (id: string, fare: number) => ({
      id,
      estimatedFare: fare,
      vehicleVariant: "AUTO_RICKSHAW",
      serviceTierName: id === "auto" ? "Auto" : "Cab",
      estimatedPickupDuration: 240,
      totalFareRange: { minFare: fare - 10, maxFare: fare + 10 },
    });
    const replies = [
      () => nyError("SEARCH_REQUEST_NOT_FOUND", "Not ready"),
      () => json({ estimates: [estimate("auto", 120)] }),
      () => json({ estimates: [estimate("auto", 120), estimate("cab", 260), { id: "broken" }] }),
      () => json({ estimates: [estimate("auto", 120), estimate("cab", 260)] }),
    ];
    let call = 0;
    const { ny, fetchImpl } = client(() => replies[Math.min(call++, replies.length - 1)]!());

    const estimates = await ny.estimates("rider-token", "search-1");
    expect(estimates.map((e) => [e.tier, e.fare])).toEqual([
      ["Auto", 120],
      ["Cab", 260],
    ]);
    expect(estimates[0]).toMatchObject({ minFare: 110, maxFare: 130, pickupSeconds: 240 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("treats a 401 as the rider's sign-in having ended", async () => {
    const { ny } = client(() => nyError("INVALID_TOKEN", "Invalid token", 401));
    await expect(ny.rideProgress("old-token", "ride-1")).rejects.toMatchObject({ code: "NY_SIGNED_OUT" });
  });

  it("keeps other failures generic so nothing from upstream leaks", async () => {
    const { ny } = client(() => nyError("INTERNAL", "stack trace here", 500));
    const error = await ny.select("rider-token", "estimate-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).not.toContain("stack trace");
  });

  it("fails generically when Namma Yatri can't be reached", async () => {
    const fetchImpl = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    const ny = new NammaYatriClient({ baseUrl: BASE, fetchImpl });
    await expect(ny.recentBookings("rider-token")).rejects.toMatchObject({ service: "Namma Yatri", status: undefined });
  });

  it("reads bookings, the ride on them and the driver's live position", async () => {
    const ride = { id: "ride-1", status: "NEW", driverName: "Manju", vehicleNumber: "KA01AB1234", vehicleModel: "Bajaj RE", vehicleColor: "Green", rideOtp: "4821" };
    const { ny, fetchImpl } = client((path) => {
      if (path.startsWith("/rideBooking/list")) {
        return json({ list: [{ id: "booking-1", status: "TRIP_ASSIGNED", createdAt: "2026-11-16T10:00:00.123Z", rideList: [ride] }, { id: "bad" }] });
      }
      return json({ ride: { ...ride, status: "INPROGRESS" }, driverPosition: { lat: 12.975, lon: 77.625 } });
    });

    const [booking, ...rest] = await ny.recentBookings("rider-token");
    expect(rest).toEqual([]);
    expect(booking).toMatchObject({
      id: "booking-1",
      status: "TRIP_ASSIGNED",
      rideId: "ride-1",
      rideStatus: "NEW",
      driver: { name: "Manju", vehicleNumber: "KA01AB1234", vehicle: "Bajaj RE · Green", otp: "4821" },
    });
    expect(booking!.createdAt.toISOString()).toBe("2026-11-16T10:00:00.123Z");
    await expect(ny.rideProgress("rider-token", "ride-1")).resolves.toMatchObject({ status: "INPROGRESS", position: [77.625, 12.975] });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init).toMatchObject({ method: "GET" });
    expect(init!.body).toBeUndefined();
    expect(headerOf(init!, "Content-Type")).toBeUndefined();
    expect(headerOf(init!, "token")).toBe("rider-token");
  });

  it("cancels a booking at the stage it is in, and a search before any driver", async () => {
    const { ny, fetchImpl } = client(() => json({ result: "Success" }));
    await ny.cancelBooking("rider-token", "booking-1", true);
    await ny.cancelBooking("rider-token", "booking-2", false);
    await ny.cancelSearch("rider-token", "estimate-1");
    const calls = fetchImpl.mock.calls.map(([url, init]) => [String(url).slice(BASE.length), bodyOf(init!)]);
    expect(calls).toEqual([
      ["/rideBooking/booking-1/cancel", expect.objectContaining({ reasonStage: "OnAssign" })],
      ["/rideBooking/booking-2/cancel", expect.objectContaining({ reasonStage: "OnSearch" })],
      ["/estimate/estimate-1/cancelSearch", {}],
    ]);
    expect(ny.shareUrl("ride 1")).toBe("https://www.nammayatri.in/u?vp=shareRide&rideId=ride%201");
  });
});
