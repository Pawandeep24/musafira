import type { BBox, LngLat } from "../../src/geo/geometry.js";

export interface CityDefinition {
  readonly id: string;
  readonly name: string;
  readonly center: LngLat;
  readonly bbox: BBox;
  readonly utcOffsetMinutes: number;
}

const IST = 330;

export const CITY_DEFINITIONS: readonly CityDefinition[] = [
  {
    id: "pune",
    name: "Pune",
    center: [73.8567, 18.5204],
    bbox: { west: 73.7, south: 18.4, east: 74.05, north: 18.7 },
    utcOffsetMinutes: IST,
  },
  {
    id: "bengaluru",
    name: "Bengaluru",
    center: [77.5946, 12.9716],
    bbox: { west: 77.45, south: 12.82, east: 77.8, north: 13.15 },
    utcOffsetMinutes: IST,
  },
];
