import { z } from "zod";
import type { PlaceKind } from "#src/city/cityData.js";
import type { BBox, LngLat } from "#src/geo/geometry.js";
import { fetchJson } from "#src/lib/http.js";
import type { Geocoder, Place } from "#src/planner/ports.js";

const BASE_URL = "https://api.heigit.org/pelias/v1";
const LAYERS = "venue,address,street,neighbourhood,locality";
const KIND_BY_LAYER: Readonly<Record<string, PlaceKind>> = {
  neighbourhood: "area",
  locality: "area",
  street: "street",
  address: "street",
};

const featureCollection = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        id: z.string().optional(),
        gid: z.string().optional(),
        name: z.string(),
        label: z.string(),
        layer: z.string().optional(),
      }),
    }),
  ),
});

const toPlaces = (collection: z.infer<typeof featureCollection>): Place[] =>
  collection.features.map((f) => ({
    id: f.properties.gid ?? f.properties.id ?? f.properties.label,
    name: f.properties.name,
    label: f.properties.label,
    point: f.geometry.coordinates,
    kind: KIND_BY_LAYER[f.properties.layer ?? ""] ?? "landmark",
  }));

/** openrouteservice (HeiGIT) Pelias geocoding: autocomplete and reverse lookup. */
export class OrsGeocoder implements Geocoder {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async suggest(text: string, focus: LngLat, within: BBox): Promise<Place[]> {
    const params = new URLSearchParams({
      text,
      "focus.point.lon": String(focus[0]),
      "focus.point.lat": String(focus[1]),
      "boundary.rect.min_lon": String(within.west),
      "boundary.rect.min_lat": String(within.south),
      "boundary.rect.max_lon": String(within.east),
      "boundary.rect.max_lat": String(within.north),
      "boundary.country": "IN",
      layers: LAYERS,
      size: "6",
    });
    return toPlaces(await this.#get(`/autocomplete?${params}`));
  }

  async reverse([lon, lat]: LngLat): Promise<Place | undefined> {
    const params = new URLSearchParams({ "point.lon": String(lon), "point.lat": String(lat), layers: LAYERS, size: "1" });
    return toPlaces(await this.#get(`/reverse?${params}`))[0];
  }

  #get(path: string) {
    return fetchJson(this.fetchImpl, "Place search", `${BASE_URL}${path}`, featureCollection, {
      headers: { Authorization: this.apiKey },
      timeoutMs: 6000,
    });
  }
}
