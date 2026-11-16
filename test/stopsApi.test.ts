import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth/tokenVerifier.js";
import { createCityRegistry } from "../src/city/cityRegistry.js";
import { loadEnv } from "../src/config/env.js";
import type { SafeStopStore } from "../src/db/safeStopStore.js";
import { GoDaddyClient } from "../src/integrations/godaddy/client.js";
import { StaticTokenProvider } from "../src/integrations/godaddy/tokenProvider.js";
import { unauthorized } from "../src/lib/errors.js";
import type { DomainLookup, RouteProvider } from "../src/planner/ports.js";
import { createRoutePlanner } from "../src/planner/routePlanner.js";
import { createSafeStops } from "../src/planner/safeStops.js";
import type { SafeStop } from "../src/stops/safeStop.js";
import { MIDDLE_LON, NIGHT, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, safeStopAnswers, straightRoute, testCity } from "./fixtures.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const verifier: TokenVerifier = {
  verify: async (token) => {
    if (token === "vendor-token") return { uid: "vendor-1", emailVerified: false, claims: {} };
    if (token === "other-token") return { uid: "vendor-2", emailVerified: false, claims: {} };
    throw unauthorized("Invalid or expired token");
  },
};
const vendor = { authorization: "Bearer vendor-token" };
const other = { authorization: "Bearer other-token" };

function memoryStore(): SafeStopStore {
  const stops = new Map<string, SafeStop>();
  return {
    get: async (id) => stops.get(id),
    byOwner: async (uid) => [...stops.values()].filter((s) => s.ownerUid === uid),
    listed: async () => [...stops.values()].filter((s) => s.status === "listed"),
    save: async (stop) => void stops.set(stop.id, stop),
  };
}

function fakeDns() {
  const txt = new Map<string, string[]>();
  const registrars = new Map<string, string>([["sharmachai.in", "GoDaddy.com, LLC"]]);
  const lookup: DomainLookup = {
    txt: async (name) => txt.get(name) ?? [],
    registrar: async (domain) => registrars.get(domain),
  };
  return { txt, registrars, lookup };
}

async function setup({ godaddy }: { godaddy?: GoDaddyClient } = {}) {
  const cities = createCityRegistry([testCity()]);
  const dns = fakeDns();
  const now = () => NIGHT;
  const safeStops = createSafeStops({ store: memoryStore(), cities, lookup: dns.lookup, now, ...(godaddy ? { godaddy } : {}) });
  const routing: RouteProvider = { routes: vi.fn(async () => [straightRoute()]) };
  const planner = createRoutePlanner({ cities, routing, now, safeStops });
  const app = await buildApp({ env, verifier, cities, planner, safeStops, now });
  return { app, dns };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

async function createStop(app: App, answers: object = safeStopAnswers) {
  const res = await app.inject({ method: "POST", url: "/api/stops", headers: vendor, payload: answers });
  expect(res.statusCode).toBe(201);
  return res.json().stop as { id: string; status: string; verify: { name: string; value: string } };
}

describe("Safe Stops API", () => {
  it("creates a draft for a signed-in vendor and returns the TXT record to publish", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/stops", payload: safeStopAnswers })).statusCode).toBe(401);
    const stop = await createStop(app);
    expect(stop.status).toBe("draft");
    expect(stop.verify.name).toBe("_musafira.sharmachai.in");
    expect(stop.verify.value).toMatch(/^musafira-verify=[0-9a-f]{16}$/);
    expect((await app.inject({ method: "GET", url: `/api/stops/${stop.id}` })).statusCode).toBe(404);
  });

  it("lists a stop only when its TXT record is published and the domain is with GoDaddy", async () => {
    const { app, dns } = await setup();
    const stop = await createStop(app);
    const verify = () => app.inject({ method: "POST", url: `/api/stops/${stop.id}/verify`, headers: vendor });

    const noRecord = (await verify()).json();
    expect(noRecord.checks).toEqual({ codeFound: false, registrar: "GoDaddy.com, LLC", godaddy: true });
    expect(noRecord.stop.status).toBe("draft");

    dns.txt.set(stop.verify.name, ["unrelated", stop.verify.value]);
    dns.registrars.set("sharmachai.in", "Example Registrar Ltd");
    const elsewhere = (await verify()).json();
    expect(elsewhere.checks).toMatchObject({ codeFound: true, godaddy: false });
    expect(elsewhere.stop.status).toBe("draft");

    dns.registrars.set("sharmachai.in", "GoDaddy.com, LLC");
    const listed = (await verify()).json();
    expect(listed.stop).toMatchObject({ status: "listed", registrar: "GoDaddy.com, LLC" });

    const page = await app.inject({ method: "GET", url: `/api/stops/${stop.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.json().stop).toMatchObject({ profile: { name: "Sharma Chai" }, open: true });
    expect(page.json().stop).not.toHaveProperty("verify");
    expect(page.json().stop).not.toHaveProperty("ownerUid");
  });

  it("shows a listed stop in washrooms near me and as a stop on planned routes", async () => {
    const { app, dns } = await setup();
    const stop = await createStop(app);
    dns.txt.set(stop.verify.name, [stop.verify.value]);
    await app.inject({ method: "POST", url: `/api/stops/${stop.id}/verify`, headers: vendor });

    const near = await app.inject({ method: "GET", url: `/api/washrooms?lon=${MIDDLE_LON}&lat=${ROUTE_LAT}` });
    expect(near.statusCode).toBe(200);
    expect(near.json().washrooms[0]).toMatchObject({ id: `stop:${stop.id}`, source: "safeStop", facts: { women: true, pads: true } });

    const plan = await app.inject({ method: "POST", url: "/api/plan", payload: { from: [ROUTE_WEST, ROUTE_LAT], to: [ROUTE_EAST, ROUTE_LAT] } });
    expect(plan.json().routes[0].stops).toContainEqual(expect.objectContaining({ id: `stop:${stop.id}`, category: "safe_stop", open: true }));
  });

  it("keeps a vendor's stops away from other accounts", async () => {
    const { app } = await setup();
    const stop = await createStop(app);
    expect((await app.inject({ method: "PUT", url: `/api/stops/${stop.id}`, headers: other, payload: safeStopAnswers })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/stops/${stop.id}/verify`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/stops/mine", headers: other })).json().stops).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/stops/mine", headers: vendor })).json().stops).toHaveLength(1);
  });

  it("takes a listed stop back to draft with a new code when its domain changes", async () => {
    const { app, dns } = await setup();
    const stop = await createStop(app);
    dns.txt.set(stop.verify.name, [stop.verify.value]);
    await app.inject({ method: "POST", url: `/api/stops/${stop.id}/verify`, headers: vendor });

    const renamed = await app.inject({ method: "PUT", url: `/api/stops/${stop.id}`, headers: vendor, payload: { ...safeStopAnswers, name: "Sharma Chai & Snacks" } });
    expect(renamed.json().stop.status).toBe("listed");

    const moved = await app.inject({ method: "PUT", url: `/api/stops/${stop.id}`, headers: vendor, payload: { ...safeStopAnswers, domain: "sharmasnacks.in" } });
    expect(moved.json().stop.status).toBe("draft");
    expect(moved.json().stop.verify.value).not.toBe(stop.verify.value);
    expect((await app.inject({ method: "GET", url: `/api/stops/${stop.id}` })).statusCode).toBe(404);
  });

  it("rejects incomplete answers and places outside the covered cities", async () => {
    const { app } = await setup();
    const incomplete = await app.inject({ method: "POST", url: "/api/stops", headers: vendor, payload: { ...safeStopAnswers, promise: false } });
    expect(incomplete.statusCode).toBe(400);
    const outside = await app.inject({ method: "POST", url: "/api/stops", headers: vendor, payload: { ...safeStopAnswers, point: [77.59, 12.97] } });
    expect(outside.statusCode).toBe(422);
    expect(outside.json().error.code).toBe("OUTSIDE_COVERAGE");
  });

  it("suggests web addresses, trusting the registry over GoDaddy's sandbox for taken names", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const domain = new URL(String(url)).searchParams.get("domain");
      return new Response(JSON.stringify({ available: true, domain }), { headers: { "content-type": "application/json" } });
    });
    const godaddy = new GoDaddyClient({ tokenProvider: new StaticTokenProvider("test"), baseUrl: "https://api.test", fetchImpl: fetchImpl as typeof fetch });
    const { app } = await setup({ godaddy });
    const res = await app.inject({ method: "POST", url: "/api/stops/domain-ideas", headers: vendor, payload: { name: "Sharma Chai", cityId: "testville" } });
    expect(res.statusCode).toBe(200);
    const ideas = res.json().ideas as { domain: string; available: boolean; buyUrl: string }[];
    expect(ideas.find((i) => i.domain === "sharmachai.in")?.available).toBe(false);
    expect(ideas.find((i) => i.domain === "sharmachai.com")).toMatchObject({ available: true, buyUrl: expect.stringContaining("godaddy.com") });
  });

  it("falls back to the registry alone when GoDaddy isn't configured", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/stops/domain-ideas", headers: vendor, payload: { name: "Sharma Chai", cityId: "testville" } });
    const ideas = res.json().ideas as { domain: string; available: boolean }[];
    expect(ideas.map((i) => [i.domain, i.available])).toContainEqual(["sharmachai.in", false]);
    expect(ideas.map((i) => [i.domain, i.available])).toContainEqual(["sharmachai.com", true]);
  });
});
