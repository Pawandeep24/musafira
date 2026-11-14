import { z } from "zod";

export const POI_CATEGORIES = [
  "police",
  "hospital",
  "clinic",
  "doctors",
  "pharmacy",
  "fuel",
  "hotel",
  "convenience",
  "supermarket",
  "shop",
  "restaurant",
  "cafe",
  "fast_food",
  "bike_repair",
  "bus_stop",
  "transit_station",
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export const PLACE_KINDS = ["area", "residence", "landmark", "street"] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

const lngLat = z.tuple([z.number(), z.number()]);

const poiSchema = z.object({
  id: z.string(),
  lon: z.number(),
  lat: z.number(),
  cat: z.enum(POI_CATEGORIES),
  name: z.string().optional(),
  hours: z.string().optional(),
});

/** A searchable named place; `aka` holds alternative and local-script names. */
const namedPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  lon: z.number(),
  lat: z.number(),
  kind: z.enum(PLACE_KINDS),
  aka: z.array(z.string()).optional(),
});

/** Row-major raster, row 0 at `north`. `values` uses `null` for no-data cells. */
const gridSchema = z.object({
  west: z.number(),
  north: z.number(),
  cellDegrees: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  values: z.array(z.number().nullable()),
});

const sourceSchema = z.object({
  name: z.string(),
  license: z.string(),
  attribution: z.string(),
  url: z.string().url(),
});

export const cityDataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  center: lngLat,
  bbox: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
  utcOffsetMinutes: z.number().int(),
  pois: z.array(poiSchema),
  places: z.array(namedPlaceSchema).default([]),
  lights: gridSchema.optional(),
  cellDensity: gridSchema.optional(),
  sources: z.array(sourceSchema),
});

export type CityData = z.infer<typeof cityDataSchema>;
export type Poi = z.infer<typeof poiSchema>;
export type NamedPlace = z.infer<typeof namedPlaceSchema>;
export type Grid = z.infer<typeof gridSchema>;
export type DataSource = z.infer<typeof sourceSchema>;
