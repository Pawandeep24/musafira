import { describe, expect, it, vi } from "vitest";
import { buildApp } from "#src/app.js";
import type { TokenVerifier } from "#src/auth/tokenVerifier.js";
import type { NamedPlace } from "#src/city/cityData.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import { createCityRegistry } from "#src/city/cityRegistry.js";
import { loadEnv } from "#src/config/env.js";
import type { Preferences, PreferencesStore } from "#src/db/preferencesStore.js";
import type { ReportStore, StoredReport } from "#src/db/reportStore.js";
import { unauthorized } from "#src/lib/errors.js";
import { createCommunityReports } from "#src/planner/communityReports.js";
import type { Geocoder, RouteProvider } from "#src/planner/ports.js";
import { createRoutePlanner } from "#src/planner/routePlanner.js";
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS } from "#src/safety/parameters.js";
import { MIDDLE_LON, NIGHT, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, straightRoute, testCity } from "#test/fixtures.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const verifier: TokenVerifier = {
  verify: async (token) => {
    if (token !== "good-token") throw unauthorized("Invalid or expired token");
    return { uid: "rider-1", emailVerified: true, claims: {} };
  },
};
const auth = { authorization: "Bearer good-token" };
const from = [ROUTE_WEST, ROUTE_LAT];
const to = [ROUTE_EAST, ROUTE_LAT];

interface SetupOptions {
  geocoder?: Geocoder;
  preferences?: PreferencesStore;
  reportStore?: ReportStore;
  city?: CityIndex;
}

async function setup({ geocoder, preferences, reportStore, city = testCity() }: SetupOptions = {}) {
  const cities = createCityRegistry([city]);
  const routing: RouteProvider = {
    routes: vi.fn(async () => [straightRoute({ roadClass: "residential", speedMps: 10 }), straightRoute({ roadClass: "primary" })]),
  };
  const now = () => NIGHT;
  const reports = reportStore ? createCommunityReports({ store: reportStore, cities, now }) : undefined;
  const planner = createRoutePlanner({ cities, routing, now, ...(reports ? { reports } : {}) });
  const app = await buildApp({
    env,
    verifier,
    cities,
    planner,
    now,
    ...(geocoder ? { geocoder } : {}),
    ...(preferences ? { preferences } : {}),
    ...(reports ? { reports } : {}),
  });
  return { app, routing, reports };
}

describe("route planning API", () => {
  it("scores and ranks routes for a guest, without sign-in", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/plan", payload: { from, to } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.searchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.city).toEqual({ id: "testville", name: "Testville", dataVersion: "test-1" });
    expect(body.routes).toHaveLength(2);
    expect(body.routes[0].labels).toContain("safest");
    expect(body.routes[0].score).toBeGreaterThanOrEqual(body.routes[1].score);
    expect(body.routes.find((r: { labels: string[] }) => r.labels.includes("fastest"))).toBeDefined();
    expect(body.routes[0].segments[0]).toMatchObject({ dark: true, values: { lighting: expect.any(Number) } });
  });

  it("rescoring a search re-weights without calling the router again", async () => {
    const { app, routing } = await setup();
    const plan = (await app.inject({ method: "POST", url: "/api/plan", payload: { from, to } })).json();
    const res = await app.inject({
      method: "POST",
      url: `/api/plan/${plan.searchId}/score`,
      payload: { weights: { lighting: 0, roadType: 10 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().searchId).toBe(plan.searchId);
    expect(res.json().routes[0].penalties.darkStretches).toBe(0);
    expect(routing.routes).toHaveBeenCalledTimes(1);
  });

  it("rejects points outside the covered cities with 422", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/plan", payload: { from: [77.59, 12.97], to } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("OUTSIDE_COVERAGE");
  });

  it("validates weights, unknown fields and departure window", async () => {
    const { app } = await setup();
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/plan", payload: { from, to, ...payload } });
    expect((await post({ weights: { lighting: 11 } })).statusCode).toBe(400);
    expect((await post({ weights: { crime: 2 } })).statusCode).toBe(200);
    expect((await post({ departAt: "2027-02-01T10:00:00+05:30" })).statusCode).toBe(400);
    expect((await post({ departAt: "2026-11-15T07:00:00+05:30" })).statusCode).toBe(200);
  });

  it("returns 404 for an expired or unknown search", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: `/api/plan/${crypto.randomUUID()}/score`, payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("exposes parameters, presets and cities for the client", async () => {
    const { app } = await setup();
    const body = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(body.parameters).toHaveLength(8);
    expect(body.defaults.weights).toEqual(DEFAULT_WEIGHTS);
    expect(body.cities.map((c: { id: string }) => c.id)).toEqual(["testville"]);
  });

  it("serves a city's night-light and signal grids for map layers", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/cities/testville/layers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().lights.cols).toBe(60);
    expect((await app.inject({ method: "GET", url: "/api/cities/atlantis/layers" })).statusCode).toBe(404);
  });
});

describe("places API", () => {
  const society = (id: string, name: string): NamedPlace => ({ id, name, lon: 73.83, lat: 18.52, kind: "residence" });
  const kumarCity = testCity({
    places: ["Prithvi", "Palms", "Sansar", "Classic", "Crystal"].map((name, i) => society(`r${i}`, `Kumar ${name}`)),
  });
  const koregaon = { id: "ors:1", name: "Koregaon Park", label: "Koregaon Park, Pune", point: [73.89, 18.53] as const, kind: "area" as const };
  const suggestUrl = (q: string) => `/api/places/suggest?q=${encodeURIComponent(q)}&city=testville`;

  it("suggests housing societies from city data, without a geocoder", async () => {
    const { app } = await setup({ city: kumarCity });
    const res = await app.inject({ method: "GET", url: suggestUrl("kumar pruth") });
    expect(res.statusCode).toBe(200);
    expect(res.json().places[0]).toMatchObject({ name: "Kumar Prithvi", kind: "residence" });
  });

  it("does not call the geocoder when city data has enough matches or the place being typed", async () => {
    const suggest = vi.fn(async () => [koregaon]);
    const { app } = await setup({ city: kumarCity, geocoder: { suggest, reverse: vi.fn() } });
    expect((await app.inject({ method: "GET", url: suggestUrl("kumar") })).json().places).toHaveLength(5);
    expect((await app.inject({ method: "GET", url: suggestUrl("kumar pri") })).json().places).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: suggestUrl("kumar pruthvi") })).json().places).toHaveLength(1);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("tops up thin local results from the geocoder within the chosen city", async () => {
    const suggest = vi.fn(async () => [koregaon]);
    const { app } = await setup({ geocoder: { suggest, reverse: vi.fn() } });
    const res = await app.inject({ method: "GET", url: suggestUrl("koregaon") });
    expect(res.statusCode).toBe(200);
    expect(res.json().places[0].name).toBe("Koregaon Park");
    expect(suggest).toHaveBeenCalledWith("koregaon", [73.82, 18.52], testCity().data.bbox);
  });

  it("keeps local results when the geocoder fails", async () => {
    const suggest = vi.fn(async () => Promise.reject(new Error("down")));
    const { app } = await setup({ city: kumarCity, geocoder: { suggest, reverse: vi.fn() } });
    const res = await app.inject({ method: "GET", url: suggestUrl("kumar pirthvi") });
    expect(res.statusCode).toBe(200);
    expect(res.json().places.map((p: { name: string }) => p.name)).toEqual(["Kumar Prithvi"]);
    expect(suggest).toHaveBeenCalledOnce();
  });

  it("returns 503 for reverse lookup when no geocoder is configured", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/places/reverse?lon=73.82&lat=18.52" });
    expect(res.statusCode).toBe(503);
  });
});

describe("preferences API", () => {
  const memoryStore = (): PreferencesStore => {
    const saved = new Map<string, Preferences>();
    return { get: async (uid) => saved.get(uid), save: async (uid, p) => void saved.set(uid, p) };
  };

  it("requires sign-in", async () => {
    const { app } = await setup({ preferences: memoryStore() });
    expect((await app.inject({ method: "GET", url: "/api/me/preferences" })).statusCode).toBe(401);
  });

  it("saves and returns a rider's weights, filling defaults", async () => {
    const { app } = await setup({ preferences: memoryStore() });
    const put = await app.inject({
      method: "PUT",
      url: "/api/me/preferences",
      headers: auth,
      payload: { weights: { lighting: 7 }, options: {}, presetId: "night-solo" },
    });
    expect(put.statusCode).toBe(200);
    const got = (await app.inject({ method: "GET", url: "/api/me/preferences", headers: auth })).json();
    expect(got.preferences).toEqual({ weights: { ...DEFAULT_WEIGHTS, lighting: 7 }, options: DEFAULT_OPTIONS, presetId: "night-solo" });
  });

  it("says when storage isn't configured", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/me/preferences", headers: auth });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("NOT_CONFIGURED");
  });
});

describe("rider reports API", () => {
  const memoryReportStore = () => {
    const saved = new Map<string, StoredReport>();
    const store: ReportStore = { save: async (r) => void saved.set(r.id, r), observedSince: async () => [...saved.values()] };
    return { saved, store };
  };
  const middle = [MIDDLE_LON, ROUTE_LAT];
  type App = Awaited<ReturnType<typeof setup>>["app"];
  const sendReport = (app: App, payload: object, headers: Record<string, string> = auth) =>
    app.inject({ method: "POST", url: "/api/reports", headers, payload });
  const plan = async (app: App) => (await app.inject({ method: "POST", url: "/api/plan", payload: { from, to } })).json();

  it("requires sign-in", async () => {
    const { app } = await setup({ reportStore: memoryReportStore().store });
    expect((await sendReport(app, { point: middle, category: "harassment" }, {})).statusCode).toBe(401);
  });

  it("lowers routes that pass a reported spot and lists it along the way, without storing who reported", async () => {
    const { saved, store } = memoryReportStore();
    const { app } = await setup({ reportStore: store });
    const before = await plan(app);

    const res = await sendReport(app, { point: middle, category: "harassment" });
    expect(res.statusCode).toBe(201);
    expect(res.json().report).toEqual({ category: "harassment", point: middle, observedAt: NIGHT.toISOString() });

    const after = await plan(app);
    expect(after.routes[0].score).toBeLessThan(before.routes[0].score);
    expect(after.routes[0].penalties.reported).toBeGreaterThan(0);
    expect(after.routes[0].reports).toEqual([expect.objectContaining({ category: "harassment", count: 1 })]);
    expect(JSON.stringify([...saved.values()])).not.toContain("rider-1");
  });

  it("rejects reports outside covered cities and unknown categories", async () => {
    const { app } = await setup({ reportStore: memoryReportStore().store });
    expect((await sendReport(app, { point: [77.59, 12.97], category: "harassment" })).statusCode).toBe(422);
    expect((await sendReport(app, { point: middle, category: "aliens" })).statusCode).toBe(400);
  });

  it("counts a rider repeating the same report at the same spot once", async () => {
    const { saved, store } = memoryReportStore();
    const { app } = await setup({ reportStore: store });
    await sendReport(app, { point: middle, category: "poorlyLit" });
    await sendReport(app, { point: middle, category: "poorlyLit" });
    expect(saved.size).toBe(1);
    expect((await plan(app)).routes[0].reports[0].count).toBe(1);
  });

  it("limits how many reports one rider can send in an hour", async () => {
    const { app } = await setup({ reportStore: memoryReportStore().store });
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await sendReport(app, { point: [ROUTE_WEST + i * 0.005, ROUTE_LAT], category: "deserted" })).statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("returns reports around the trip for the map, merged per spot and tagged with the routes they affect", async () => {
    const { store } = memoryReportStore();
    const stored = (id: string, lat: number): StoredReport => ({
      id,
      cityId: "testville",
      category: "harassment",
      point: [MIDDLE_LON, lat],
      observedAt: NIGHT,
    });
    await store.save(stored("rider-a", ROUTE_LAT));
    await store.save(stored("rider-b", ROUTE_LAT));
    await store.save(stored("nearby", ROUTE_LAT + 0.005));
    await store.save(stored("far-away", ROUTE_LAT + 0.05));
    const { app, reports } = await setup({ reportStore: store });
    await reports!.load();

    const body = await plan(app);
    const onRoute = body.reports.find((r: { count: number }) => r.count === 2);
    const offRoute = body.reports.find((r: { point: [number, number] }) => r.point[1] > ROUTE_LAT + 0.001);
    expect(body.reports).toHaveLength(2);
    expect(onRoute.routeIds).toEqual(expect.arrayContaining(body.routes.map((r: { id: string }) => r.id)));
    expect(offRoute.routeIds).toEqual([]);
    expect(JSON.stringify(body.reports)).not.toContain("rider-a");
  });

  it("keeps reports across restarts", async () => {
    const { store } = memoryReportStore();
    await store.save({ id: "r1", cityId: "testville", category: "harassment", point: [MIDDLE_LON, ROUTE_LAT], observedAt: NIGHT });
    const { app, reports } = await setup({ reportStore: store });
    expect(await reports!.load()).toBe(1);
    expect((await plan(app)).routes[0].reports).toHaveLength(1);
  });
});
