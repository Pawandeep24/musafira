import type { CityData, Grid, Poi } from "../src/city/cityData.js";
import { CityIndex } from "../src/city/cityIndex.js";
import { haversineMeters, type LngLat } from "../src/geo/geometry.js";
import type { CandidateRoute } from "../src/safety/types.js";

export const ROUTE_WEST = 73.8;
export const ROUTE_EAST = 73.84;
export const ROUTE_LAT = 18.52;
export const MIDDLE_LON = (ROUTE_WEST + ROUTE_EAST) / 2;

/** 23:00 and 12:00 in Pune (IST, UTC+5:30) on a Saturday. */
export const NIGHT = new Date("2026-11-14T17:30:00Z");
export const NOON = new Date("2026-11-14T06:30:00Z");

export function straightRoute({ roadClass = "primary", speedMps = 8.33 } = {}): CandidateRoute {
  const count = 41;
  const shape: LngLat[] = Array.from({ length: count }, (_, i) => [ROUTE_WEST + ((ROUTE_EAST - ROUTE_WEST) * i) / (count - 1), ROUTE_LAT]);
  const distanceMeters = haversineMeters(shape[0]!, shape[count - 1]!);
  const durationSeconds = distanceMeters / speedMps;
  return {
    shape,
    secondsAt: shape.map((_, i) => (durationSeconds * i) / (count - 1)),
    distanceMeters,
    durationSeconds,
    roads: [{ endMeters: distanceMeters, roadClass, tunnel: false }],
  };
}

export function grid(valueAt: (lon: number) => number | null): Grid {
  const west = 73.79;
  const north = 18.53;
  const cellDegrees = 0.001;
  const cols = 60;
  const rows = 20;
  const values = Array.from({ length: rows * cols }, (_, i) => valueAt(west + ((i % cols) + 0.5) * cellDegrees));
  return { west, north, cellDegrees, cols, rows, values };
}

export const poi = (id: string, lon: number, cat: Poi["cat"], hours?: string): Poi => ({
  id,
  lon,
  lat: ROUTE_LAT + 0.0003,
  cat,
  name: `${cat} ${id}`,
  ...(hours ? { hours } : {}),
});

/** Safe Stop questionnaire answers for a cafe on the test route, ~1 km east of its middle, open 07:00-01:00. */
export const safeStopAnswers = {
  name: "Sharma Chai",
  kind: "cafe",
  point: [MIDDLE_LON + 0.0095, ROUTE_LAT],
  hours: { opens: "07:00", closes: "01:00" },
  languages: ["mr", "hi"],
  washrooms: { total: 2, women: 1, unisex: 0, accessible: 1 },
  access: "anyone",
  attendant: "always",
  pads: "free",
  cleaned: "few_daily",
  features: ["lock_inside", "lit_inside", "cctv"],
  promise: true,
  domain: "sharmachai.in",
};

export function testCity(overrides: Partial<CityData> = {}): CityIndex {
  return new CityIndex({
    id: "testville",
    name: "Testville",
    version: "test-1",
    center: [73.82, 18.52],
    bbox: { west: 73.7, south: 18.4, east: 74, north: 18.7 },
    utcOffsetMinutes: 330,
    pois: [],
    places: [],
    sights: [],
    washrooms: [],
    lights: grid(() => 40),
    cellDensity: grid(() => 50),
    sources: [],
    ...overrides,
  });
}

export function encodePolyline(points: readonly LngLat[], precision = 6): string {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLon = 0;
  let output = "";
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    output += String.fromCharCode(value + 63);
  };
  for (const [lon, lat] of points) {
    const roundedLat = Math.round(lat * factor);
    const roundedLon = Math.round(lon * factor);
    encode(roundedLat - previousLat);
    encode(roundedLon - previousLon);
    previousLat = roundedLat;
    previousLon = roundedLon;
  }
  return output;
}
