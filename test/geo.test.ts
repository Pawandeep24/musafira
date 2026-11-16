import { describe, expect, it } from "vitest";
import { distanceToPathMeters, haversineMeters } from "#src/geo/geometry.js";
import { measurePath, samplePositions } from "#src/geo/path.js";
import { decodePolyline } from "#src/geo/polyline.js";
import { encodePolyline } from "#test/fixtures.js";

describe("geo", () => {
  it("decodes Google's reference polyline at precision 5", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("round-trips Valhalla precision-6 shapes", () => {
    const points = [
      [73.856743, 18.520431],
      [73.857001, 18.52105],
    ] as const;
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });

  it("measures distances along a path", () => {
    const path = measurePath([
      [73.8, 18.52],
      [73.81, 18.52],
      [73.82, 18.52],
    ]);
    const leg = haversineMeters([73.8, 18.52], [73.81, 18.52]);
    expect(path.totalMeters).toBeCloseTo(2 * leg, 3);
    expect(path.pointAt(leg * 1.5)[0]).toBeCloseTo(73.815, 6);
  });

  it("measures a point's distance to the nearest part of a path", () => {
    const path = [
      [73.8, 18.52],
      [73.81, 18.52],
    ] as const;
    expect(distanceToPathMeters([73.805, 18.521], path)).toBeCloseTo(haversineMeters([73.805, 18.52], [73.805, 18.521]), 0);
    expect(distanceToPathMeters([73.82, 18.52], path)).toBeCloseTo(haversineMeters([73.81, 18.52], [73.82, 18.52]), 0);
  });

  it("spaces samples evenly and caps their number", () => {
    expect(samplePositions(10_000, 2000, 6)).toEqual([1000, 3000, 5000, 7000, 9000]);
    expect(samplePositions(100_000, 2000, 6)).toHaveLength(6);
  });
});
