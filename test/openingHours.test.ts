import { afterEach, describe, expect, it } from "vitest";
import type { Poi } from "#src/city/cityData.js";
import { createHoursEvaluator } from "#src/city/openingHours.js";

const evaluator = () => createHoursEvaluator([73.8567, 18.5204], 330);
const place = (cat: Poi["cat"], hours?: string): Poi => ({ id: "p", lon: 73.85, lat: 18.52, cat, ...(hours ? { hours } : {}) });
const originalZone = process.env.TZ;

describe("opening hours", () => {
  afterEach(() => {
    process.env.TZ = originalZone;
  });

  it.each(["UTC", "America/Los_Angeles", "Asia/Kolkata"])("reads OSM hours in city time when the server runs in %s", (zone) => {
    process.env.TZ = zone;
    const shop = place("shop", "Mo-Su 09:00-21:00");
    const at2030Ist = new Date("2026-11-14T15:00:00Z");
    const state = evaluator().stateAt(shop, at2030Ist);
    expect(state).toEqual({ open: true, estimated: false, closesAt: new Date("2026-11-14T15:30:00Z") });
    expect(evaluator().stateAt(shop, new Date("2026-11-14T16:00:00Z")).open).toBe(false);
  });

  it("falls back to category defaults, flagged as estimated, including hours past midnight", () => {
    const at0015Ist = new Date("2026-11-14T18:45:00Z");
    expect(evaluator().stateAt(place("fast_food"), at0015Ist)).toEqual({
      open: true,
      estimated: true,
      closesAt: new Date("2026-11-14T19:00:00Z"),
    });
    expect(evaluator().stateAt(place("shop"), at0015Ist)).toEqual({ open: false, estimated: true });
  });

  it("gives trip sights typical hours when OSM has none", () => {
    const museum = { cat: "museum", hours: undefined } as const;
    expect(evaluator().stateAt(museum, new Date("2026-11-14T02:30:00Z"))).toEqual({ open: false, estimated: true });
    expect(evaluator().stateAt(museum, new Date("2026-11-14T05:30:00Z"))).toMatchObject({ open: true, estimated: true });
  });

  it("treats police and hospitals as always open and ignores unparseable tags", () => {
    const at = new Date("2026-11-14T21:00:00Z");
    expect(evaluator().stateAt(place("police"), at).open).toBe(true);
    expect(evaluator().stateAt(place("hospital", "ask at counter??"), at)).toEqual({ open: true, estimated: true });
  });
});
