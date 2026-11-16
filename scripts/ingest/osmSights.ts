/**
 * Sights for trip itineraries, picked from the same OpenStreetMap download as the named places.
 *
 * kind: tourism=museum → museum, amenity=marketplace → market, historic=* → heritage (memorials and
 * other small markers only when famous), amenity=place_of_worship → worship, parks, gardens and
 * viewpoints → nature (only when famous, tourism-tagged or named like a garden, lake or hill, because
 * most OSM parks are small neighbourhood plots), tourism=attraction → attraction.
 * `famous` means OSM links the place to Wikidata, Wikipedia or a heritage register; it is the only
 * popularity signal OSM has. Every named place of worship is kept, because much-loved temples
 * (Dagdusheth, Bull Temple) often have no such link; the planner offers unlinked ones only to riders
 * who ask for temples.
 * One place mapped twice (Aga Khan Palace as a monument and an attraction) merges by name within
 * MERGE_METERS, keeping the famous one, then the first by KIND_ORDER.
 */
import type { Sight, SightKind } from "../../src/city/cityData.js";
import { foldText } from "../../src/city/placeSearch.js";
import { haversineMeters } from "../../src/geo/geometry.js";
import type { OverpassElement } from "./osmPois.js";

const MERGE_METERS = 500;
const KIND_ORDER: readonly SightKind[] = ["heritage", "museum", "worship", "nature", "market", "attraction"];
const HISTORIC_SIGHTS = new Set(["fort", "castle", "palace", "monument", "ruins", "building", "city_gate", "archaeological_site", "tomb", "manor", "temple"]);
const NATURE_NAME = /\b(gardens?|botanical|lake|udyan|baug|bagh|hills?|tekdi|forest|zoo)\b|(baug|bagh)$/i;

export function sightKind(tags: Readonly<Record<string, string>>, name: string, famous: boolean): SightKind | undefined {
  if (tags.tourism === "museum") return "museum";
  if (tags.amenity === "marketplace") return "market";
  if (tags.historic && (HISTORIC_SIGHTS.has(tags.historic) || famous)) return "heritage";
  if (tags.amenity === "place_of_worship") return "worship";
  const green = tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "nature_reserve" || tags.tourism === "viewpoint";
  if (green && (famous || tags.tourism || NATURE_NAME.test(name))) return "nature";
  if (tags.tourism === "attraction") return "attraction";
  return undefined;
}

const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

function toSight({ type, id, lat, lon, center, tags }: OverpassElement): Sight[] {
  const name = (tags["name:en"] ?? tags.name)?.trim();
  const latitude = lat ?? center?.lat;
  const longitude = lon ?? center?.lon;
  if (!name || latitude === undefined || longitude === undefined) return [];
  const famous = Boolean(tags.wikidata || tags.wikipedia || tags.heritage);
  const kind = sightKind(tags, name, famous);
  if (!kind) return [];
  return [
    {
      id: `${type[0]}${id}`,
      name,
      lon: round(longitude),
      lat: round(latitude),
      kind,
      ...(famous ? { famous } : {}),
      ...(tags.opening_hours ? { hours: tags.opening_hours } : {}),
    },
  ];
}

export function toSights(elements: readonly OverpassElement[]): Sight[] {
  const candidates = elements
    .flatMap(toSight)
    .sort((a, b) => Number(Boolean(b.famous)) - Number(Boolean(a.famous)) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const keptByName = new Map<string, Sight[]>();
  return candidates.filter((sight) => {
    const key = foldText(sight.name);
    const kept = keptByName.get(key) ?? [];
    if (kept.some((other) => haversineMeters([other.lon, other.lat], [sight.lon, sight.lat]) < MERGE_METERS)) return false;
    keptByName.set(key, [...kept, sight]);
    return true;
  });
}
