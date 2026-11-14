import { z } from "zod";
import type { Poi, PoiCategory } from "../../src/city/cityData.js";
import type { BBox } from "../../src/geo/geometry.js";
import { USER_AGENT } from "./cache.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const overpassResponse = z.object({
  elements: z.array(
    z.object({
      type: z.enum(["node", "way", "relation"]),
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).default({}),
    }),
  ),
});

export type OverpassElement = z.infer<typeof overpassResponse>["elements"][number];

export async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(360_000),
  });
  if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
  return overpassResponse.parse(await response.json()).elements;
}

const BIKE_REPAIR_SHOPS = new Set(["tyres", "motorcycle", "motorcycle_repair", "car_repair"]);
const IGNORED_SHOPS = new Set(["vacant", "no", "disused"]);

export function classify(tags: Readonly<Record<string, string>>): PoiCategory | undefined {
  const { amenity, shop, tourism, highway, railway, public_transport: transport } = tags;
  if (amenity === "police") return "police";
  if (amenity === "hospital") return "hospital";
  if (amenity === "clinic") return "clinic";
  if (amenity === "doctors") return "doctors";
  if (amenity === "pharmacy" || shop === "chemist") return "pharmacy";
  if (amenity === "fuel") return "fuel";
  if (tourism === "hotel") return "hotel";
  if (shop && BIKE_REPAIR_SHOPS.has(shop)) return "bike_repair";
  if (shop === "convenience" || shop === "kiosk") return "convenience";
  if (shop === "supermarket") return "supermarket";
  if (amenity === "restaurant") return "restaurant";
  if (amenity === "cafe") return "cafe";
  if (amenity === "fast_food") return "fast_food";
  if (shop && !IGNORED_SHOPS.has(shop)) return "shop";
  if (highway === "bus_stop") return "bus_stop";
  if (railway === "station" || transport === "station") return "transit_station";
  return undefined;
}

function query({ south, west, north, east }: BBox): string {
  return `[out:json][timeout:300][bbox:${south},${west},${north},${east}];
(
  nwr["amenity"~"^(police|hospital|clinic|doctors|pharmacy|fuel|restaurant|cafe|fast_food)$"];
  nwr["shop"];
  nwr["tourism"="hotel"];
  node["highway"="bus_stop"];
  nwr["railway"="station"];
  nwr["public_transport"="station"];
);
out tags center;`;
}

export async function fetchOsmPois(bbox: BBox): Promise<Poi[]> {
  const elements = await fetchOverpass(query(bbox));
  return elements.flatMap((element): Poi[] => {
    const cat = classify(element.tags);
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!cat || lat === undefined || lon === undefined) return [];
    const name = element.tags.name ?? element.tags["name:en"];
    const hours = element.tags.opening_hours;
    return [
      {
        id: `${element.type[0]}${element.id}`,
        lon: Math.round(lon * 1e6) / 1e6,
        lat: Math.round(lat * 1e6) / 1e6,
        cat,
        ...(name ? { name } : {}),
        ...(hours ? { hours } : {}),
      },
    ];
  });
}
