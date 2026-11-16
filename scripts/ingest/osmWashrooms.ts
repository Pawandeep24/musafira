/**
 * Public toilets from OSM (`amenity=toilets`) for "washrooms near me".
 *
 * Tags → fields:
 *   women         female=yes or unisex=yes → true; female=no without unisex=yes → false
 *   free          fee=no → true; fee=yes → false
 *   wheelchair    wheelchair=yes
 *   babyChanging  changing_table=yes
 *   pads          toilets:menstrual_products=yes|limited (OSM uses these only for free products)
 * A missing tag stays undefined, so the app can say "not recorded" instead of guessing.
 */
import type { Washroom } from "../../src/city/cityData.js";
import type { BBox } from "../../src/geo/geometry.js";
import { fetchOverpass } from "./osmPois.js";

const yesNo = (value: string | undefined, yes = "yes", no = "no") => (value === yes ? true : value === no ? false : undefined);
const flag = <K extends string>(key: K, value: boolean | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, boolean>));

export function toWashroom(id: string, lon: number, lat: number, tags: Readonly<Record<string, string>>): Washroom {
  const name = tags.name ?? tags["name:en"];
  const products = tags["toilets:menstrual_products"];
  return {
    id,
    lon: Math.round(lon * 1e6) / 1e6,
    lat: Math.round(lat * 1e6) / 1e6,
    ...(name ? { name } : {}),
    ...(tags.opening_hours ? { hours: tags.opening_hours } : {}),
    ...flag("women", tags.female === "yes" || tags.unisex === "yes" ? true : tags.female === "no" ? false : undefined),
    ...flag("free", yesNo(tags.fee, "no", "yes")),
    ...flag("wheelchair", yesNo(tags.wheelchair)),
    ...flag("babyChanging", yesNo(tags.changing_table)),
    ...flag("pads", products === "limited" ? true : yesNo(products)),
  };
}

export async function fetchOsmWashrooms({ south, west, north, east }: BBox): Promise<Washroom[]> {
  const elements = await fetchOverpass(`[out:json][timeout:120][bbox:${south},${west},${north},${east}];
nwr["amenity"="toilets"];
out tags center;`);
  return elements.flatMap((element) => {
    const lon = element.lon ?? element.center?.lon;
    const lat = element.lat ?? element.center?.lat;
    if (lon === undefined || lat === undefined) return [];
    return [toWashroom(`${element.type[0]}${element.id}`, lon, lat, element.tags)];
  });
}
