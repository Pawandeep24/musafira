import { describe, expect, it } from "vitest";
import type { CityIndex } from "../src/city/cityIndex.js";
import { createHoursEvaluator } from "../src/city/openingHours.js";
import { analyzeRoute } from "../src/safety/analyze.js";
import type { CommunityReport, ReportCategory } from "../src/safety/community.js";
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, type Weights } from "../src/safety/parameters.js";
import { scoreRoute } from "../src/safety/scoring.js";
import type { Measurement } from "../src/safety/types.js";
import { grid, MIDDLE_LON, NIGHT, NOON, poi, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, straightRoute, testCity } from "./fixtures.js";

const analyse = (city: CityIndex, departAt: Date, reports: readonly CommunityReport[] = []) =>
  analyzeRoute({ route: straightRoute(), departAt, city, hours: createHoursEvaluator(city.data.center, 330), traffic: [], reports });
const score = (city: CityIndex, departAt: Date, weights: Weights = DEFAULT_WEIGHTS) =>
  scoreRoute(analyse(city, departAt), weights, DEFAULT_OPTIONS);

const halfDarkCity = (overrides = {}) => testCity({ lights: grid((lon) => (lon < MIDDLE_LON ? 40 : 0.3)), ...overrides });
const evenlySpacedStops = Array.from({ length: 5 }, (_, i) => poi(`h${i}`, ROUTE_WEST + ((ROUTE_EAST - ROUTE_WEST) * i) / 4, "hospital"));

describe("safety engine", () => {
  it("splits the route into ~100 m segments with increasing arrival times", () => {
    const { segments } = analyse(testCity(), NIGHT);
    expect(segments.length).toBeGreaterThan(35);
    expect(segments.every((s, i) => i === 0 || s.arrival >= segments[i - 1]!.arrival)).toBe(true);
  });

  it("ignores lighting by day and measures it after dusk", () => {
    expect(analyse(halfDarkCity(), NOON).measurements.lighting.every((v) => v === "n/a")).toBe(true);
    expect(analyse(halfDarkCity(), NIGHT).measurements.lighting.every((v) => typeof v === "number")).toBe(true);
  });

  it("flags and penalises an unlit stretch at night only", () => {
    const night = score(halfDarkCity(), NIGHT);
    expect(night.darkStretches).toHaveLength(1);
    expect(night.darkStretches[0]!.endMeters - night.darkStretches[0]!.startMeters).toBeGreaterThan(1500);
    expect(night.penalties.darkStretches).toBeGreaterThan(0);
    expect(score(halfDarkCity(), NOON).darkStretches).toHaveLength(0);
  });

  it("ranks a fully lit route above a half-dark one at night", () => {
    expect(score(testCity(), NIGHT).score).toBeGreaterThan(score(halfDarkCity(), NIGHT).score);
  });

  it("keeps heavily penalised routes above zero so they still rank", () => {
    const darkAndDisconnected = score(testCity({ lights: grid(() => 0.3), cellDensity: grid(() => 0) }), NIGHT);
    expect(darkAndDisconnected.penalties.darkStretches + darkAndDisconnected.penalties.deadZones).toBeGreaterThanOrEqual(15);
    expect(darkAndDisconnected.score).toBeGreaterThan(0);
    expect(score(halfDarkCity(), NIGHT).score).toBeGreaterThan(darkAndDisconnected.score);
  });

  it("drops a penalty when the rider zeroes its weight", () => {
    const result = score(halfDarkCity(), NIGHT, { ...DEFAULT_WEIGHTS, lighting: 0 });
    expect(result.penalties.darkStretches).toBe(0);
  });

  it("penalises long gaps between open safety stops", () => {
    const withoutStops = score(testCity(), NIGHT);
    const withStops = score(testCity({ pois: evenlySpacedStops }), NIGHT);
    expect(withoutStops.penalties.stopGap).toBeGreaterThan(0);
    expect(withStops.penalties.stopGap).toBe(0);
    expect(withStops.longestStopGapMeters).toBeLessThan(DEFAULT_OPTIONS.maxStopGapMeters);
  });

  it("marks a stop that has closed by the time the rider passes", () => {
    const fuel = poi("f1", MIDDLE_LON, "fuel", "Mo-Su 06:00-22:00");
    const [stop] = analyse(testCity({ pois: [fuel] }), NIGHT).stops;
    expect(stop).toMatchObject({ id: "f1", open: false, estimated: false, kinds: ["safety", "breakdown"] });
  });

  it("skips missing data instead of scoring it as zero, and lowers confidence", () => {
    const missing = score(testCity({ cellDensity: undefined }), NIGHT);
    const ignored = score(testCity(), NIGHT, { ...DEFAULT_WEIGHTS, signal: 0 });
    expect(missing.score).toBe(ignored.score);
    expect(missing.confidence).toBeLessThan(score(testCity(), NIGHT).confidence);
  });

  it("is deterministic for the same inputs", () => {
    expect(score(halfDarkCity({ pois: evenlySpacedStops }), NIGHT)).toEqual(score(halfDarkCity({ pois: evenlySpacedStops }), NIGHT));
  });

  it("uses live traffic as evidence of people around", () => {
    const city = testCity();
    const quiet = analyse(city, NIGHT).measurements.crowd;
    const busy = analyzeRoute({
      route: straightRoute(),
      departAt: NIGHT,
      city,
      hours: createHoursEvaluator(city.data.center, 330),
      traffic: [{ alongMeters: 2000, currentSpeedKmh: 15, freeFlowSpeedKmh: 40, confidence: 1, roadClosure: false }],
    }).measurements.crowd;
    expect(busy[20]).toBeGreaterThan(quiet[20] as number);
  });
});

describe("rider reports", () => {
  const daysBefore = (at: Date, days: number) => new Date(at.getTime() - days * 86_400_000);
  const report = (category: ReportCategory, observedAt: Date, point: readonly [number, number] = [MIDDLE_LON, ROUTE_LAT]): CommunityReport => ({
    id: `${category}-${observedAt.toISOString()}-${point.join(",")}`,
    category,
    point,
    observedAt,
  });
  const scoreWith = (departAt: Date, reports: readonly CommunityReport[]) =>
    scoreRoute(analyse(testCity(), departAt, reports), DEFAULT_WEIGHTS, DEFAULT_OPTIONS);
  const lowest = (values: readonly Measurement[]) => Math.min(...values.filter((v): v is number => typeof v === "number"));
  const poorlyLit = [1, 3, 6].map((days) => report("poorlyLit", daysBefore(NIGHT, days)));

  it("lets poor-lighting reports darken a lit road at night, but not by day", () => {
    const lit = analyse(testCity(), NIGHT);
    const reported = analyse(testCity(), NIGHT, poorlyLit);
    expect(lowest(reported.measurements.lighting)).toBeLessThan(lowest(lit.measurements.lighting));
    expect(scoreWith(NIGHT, poorlyLit).score).toBeLessThan(scoreWith(NIGHT, []).score);
    expect(reported.reports).toEqual([expect.objectContaining({ category: "poorlyLit", count: 3 })]);

    expect(scoreWith(NOON, poorlyLit).score).toBe(scoreWith(NOON, []).score);
    expect(analyse(testCity(), NOON, poorlyLit).reports).toHaveLength(0);
  });

  it("penalises a harassment report at the hour it was seen, whatever the rider's weights", () => {
    const harassment = [report("harassment", daysBefore(NIGHT, 7))];
    const night = scoreWith(NIGHT, harassment);
    expect(night.penalties.reported).toBeGreaterThan(0);
    expect(night.score).toBeLessThan(scoreWith(NIGHT, []).score);
    const zeroed = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((id) => [id, 0])) as Weights;
    expect(scoreRoute(analyse(testCity(), NIGHT, harassment), { ...zeroed, lighting: 5 }, DEFAULT_OPTIONS).penalties.reported).toBe(
      night.penalties.reported,
    );
    expect(scoreWith(NOON, harassment).penalties.reported).toBe(0);
  });

  it("ignores reports that are old or away from the route", () => {
    const stale = [report("harassment", daysBefore(NIGHT, 720))];
    const offRoute = [report("harassment", daysBefore(NIGHT, 1), [MIDDLE_LON, ROUTE_LAT + 0.002])];
    expect(scoreWith(NIGHT, stale).penalties.reported).toBe(0);
    expect(scoreWith(NIGHT, offRoute).penalties.reported).toBe(0);
    expect(analyse(testCity(), NIGHT, offRoute).reports).toHaveLength(0);
  });

  it("raises people around where riders found it busy at that time of day", () => {
    const busy = [report("busy", daysBefore(NIGHT, 2)), report("busy", daysBefore(NIGHT, 4))];
    const quiet = analyse(testCity(), NIGHT).measurements.crowd;
    const reported = analyse(testCity(), NIGHT, busy).measurements.crowd;
    expect(reported[21]).toBeGreaterThan(quiet[21] as number);
    expect(reported[5]).toBe(quiet[5]);
  });
});
