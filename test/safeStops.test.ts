import { describe, expect, it } from "vitest";
import type { Poi } from "#src/city/cityData.js";
import { createHoursEvaluator } from "#src/city/openingHours.js";
import type { LngLat } from "#src/geo/geometry.js";
import { RdapClient } from "#src/integrations/rdap/client.js";
import { UpstreamError } from "#src/lib/http.js";
import { analyzeRoute } from "#src/safety/analyze.js";
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS } from "#src/safety/parameters.js";
import { scoreRoute } from "#src/safety/scoring.js";
import { domainIdeas, osmHours, safeStopProfileSchema, type SafeStop } from "#src/stops/safeStop.js";
import { fuelStation, publicWashroom, rankWashrooms, safeStopWashroom } from "#src/stops/washrooms.js";
import { MIDDLE_LON, NIGHT, poi, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, safeStopAnswers, straightRoute, testCity } from "#test/fixtures.js";

const METERS_PER_DEGREE_LON = 105_500;
const east = (meters: number): LngLat => [MIDDLE_LON + meters / METERS_PER_DEGREE_LON, ROUTE_LAT];

const listedStop = (overrides: Partial<typeof safeStopAnswers> = {}): SafeStop => ({
  id: "abc123",
  ownerUid: "vendor-1",
  cityId: "testville",
  profile: safeStopProfileSchema.parse({ ...safeStopAnswers, ...overrides }),
  verifyCode: "code",
  status: "listed",
  updatedAt: NIGHT,
});

describe("Safe Stop questionnaire", () => {
  const parse = (overrides: Record<string, unknown>) => safeStopProfileSchema.safeParse({ ...safeStopAnswers, ...overrides });

  it("accepts a complete answer and cleans up the domain the vendor typed", () => {
    const result = parse({ domain: " https://www.SharmaChai.in/menu ", features: ["cctv", "cctv"] });
    expect(result.success).toBe(true);
    expect(result.data?.domain).toBe("sharmachai.in");
    expect(result.data?.features).toEqual(["cctv"]);
  });

  it("rejects a listing without the Safe Stop Promise", () => {
    expect(parse({ promise: false }).success).toBe(false);
  });

  it("asks for a fee exactly when the washroom is paid", () => {
    expect(parse({ access: "paid" }).success).toBe(false);
    expect(parse({ access: "paid", feeRupees: 5 }).success).toBe(true);
    expect(parse({ access: "anyone", feeRupees: 5 }).success).toBe(false);
  });

  it("rejects washroom counts above the total, and domains that aren't domains", () => {
    expect(parse({ washrooms: { total: 1, women: 1, unisex: 1, accessible: 0 } }).success).toBe(false);
    expect(parse({ domain: "sharma chai" }).success).toBe(false);
  });

  it("builds web address ideas from the shop and city names", () => {
    expect(domainIdeas("Sharma's Chai!", "Pune")).toEqual(["sharmaschai.in", "sharmaschai.com", "sharmaschaipune.in", "sharmaschaipune.com", "sharmaschai.co.in"]);
    expect(domainIdeas("चाय", "Pune")).toEqual([]);
  });

  it("treats closing before opening as open past midnight", () => {
    const hours = createHoursEvaluator(testCity().data.center, 330);
    const overnight = { cat: "safe_stop" as const, hours: osmHours({ opens: "18:00", closes: "02:00" }) };
    expect(hours.stateAt(overnight, new Date("2026-11-14T19:30:00Z")).open).toBe(true);
    expect(hours.stateAt(overnight, new Date("2026-11-14T06:30:00Z")).open).toBe(false);
    expect(osmHours({ allDay: true })).toBe("24/7");
  });
});

describe("domain registrar lookup", () => {
  const rdapWith = (status: number, body: unknown = {}) =>
    new RdapClient({ fetchImpl: async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) });

  it("names the registrar from the registry record", async () => {
    const body = {
      entities: [
        { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Owner"]]] },
        { roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "GoDaddy.com, LLC"]]] },
      ],
    };
    expect(await rdapWith(200, body).registrar("sharmachai.in")).toBe("GoDaddy.com, LLC");
  });

  it("reports an unregistered domain, and fails cleanly when the registry is down", async () => {
    expect(await rdapWith(404).registrar("free-name.in")).toBeUndefined();
    await expect(rdapWith(503).registrar("sharmachai.in")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("washrooms near me", () => {
  const hours = createHoursEvaluator(testCity().data.center, 330);
  const rank = (candidates: Parameters<typeof rankWashrooms>[2]) =>
    rankWashrooms(east(0), NIGHT, candidates, (place, at) => hours.stateAt(place, at)).map((w) => w.id);
  const toilet = (id: string, meters: number, extra: Record<string, unknown> = {}) =>
    publicWashroom({ id, lon: east(meters)[0], lat: ROUTE_LAT, hours: "24/7", ...extra });

  it("puts a well-equipped Safe Stop ahead of a nearer toilet nobody has described", () => {
    expect(rank([toilet("near", 200), safeStopWashroom(listedStop())!])).toEqual(["stop:abc123", "osm:near"]);
  });

  it("leaves out places that are closed, men-only or too far, and includes fuel stations", () => {
    const fuel: Poi = { ...poi("f1", east(600)[0], "fuel", "24/7"), lat: ROUTE_LAT };
    const ids = rank([
      toilet("closed", 100, { hours: "Mo-Su 08:00-20:00" }),
      toilet("men", 100, { women: false }),
      toilet("far", 6000),
      toilet("open", 300, { women: true }),
      fuelStation(fuel),
    ]);
    expect(ids).toEqual(["osm:open", "fuel:f1"]);
  });

  it("skips a Safe Stop that has no washroom", () => {
    expect(safeStopWashroom(listedStop({ washrooms: { total: 0, women: 0, unisex: 0, accessible: 0 } }))).toBeUndefined();
  });
});

describe("listed Safe Stops on routes", () => {
  it("count as safety stops and close the gaps between them", () => {
    const city = testCity();
    const listed = Array.from({ length: 5 }, (_, i) => poi(`stop:s${i}`, ROUTE_WEST + ((ROUTE_EAST - ROUTE_WEST) * i) / 4, "safe_stop", "Mo-Su 07:00-01:00"));
    const score = (extraPois: readonly Poi[]) =>
      scoreRoute(
        analyzeRoute({ route: straightRoute(), departAt: NIGHT, city, hours: createHoursEvaluator(city.data.center, 330), traffic: [], extraPois }),
        DEFAULT_WEIGHTS,
        DEFAULT_OPTIONS,
      );
    const without = score([]);
    const withStops = score(listed);
    expect(without.penalties.stopGap).toBeGreaterThan(0);
    expect(withStops.penalties.stopGap).toBe(0);
    expect(withStops.score).toBeGreaterThan(without.score);
  });
});
