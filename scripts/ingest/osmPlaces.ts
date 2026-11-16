/**
 * Named places riders type into search, from OpenStreetMap: housing societies (named residential land
 * and apartment buildings), areas (suburbs, neighbourhoods, villages), landmarks (schools, offices,
 * parks, temples, ...) and named streets. Scoring POIs are searchable already, so they are not fetched here.
 *
 * OSM maps one society several times (the compound, each tower, a gate) and one street as dozens of
 * ways, so same-named places closer than MERGE_METERS (streets: STREET_MERGE_METERS) are merged,
 * keeping the first by KIND_ORDER. `name:en` wins over `name`; the rest, including Marathi, Kannada
 * and Hindi names, become `aka` search aliases.
 *
 * Indian mappers often tag a society or a junction as place=neighbourhood/locality, which would make
 * "Suyojan Society" or "Nal Stop" an area and a label for everything around it, so those are
 * reclassified by name.
 */
import type { NamedPlace, PlaceKind } from "#src/city/cityData.js";
import { foldText } from "#src/city/placeSearch.js";
import { haversineMeters, type BBox } from "#src/geo/geometry.js";
import { fetchOverpass, type OverpassElement } from "#scripts/ingest/osmPois.js";

const AREA_PLACES = new Set(["suburb", "neighbourhood", "quarter", "locality", "village", "hamlet", "town"]);
const RESIDENTIAL_BUILDINGS = new Set(["apartments", "residential", "dormitory", "house"]);
const SOCIETY_NAME = /\b(society|soc|chs|co-?op|housing|apartments?|apts?|residency|towers?|heights|enclave)\b/i;
const JUNCTION_NAME = /\b(chowk|phata|circle|junction|stop|square)\b/i;
const KIND_ORDER: readonly PlaceKind[] = ["area", "residence", "landmark", "street"];
const ALIAS_TAGS = ["name", "name:mr", "name:kn", "name:hi", "alt_name", "official_name", "short_name", "old_name", "loc_name"] as const;
const MERGE_METERS = 500;
const STREET_MERGE_METERS = 2000;

export function placeKind(tags: Readonly<Record<string, string>>, name: string): PlaceKind {
  if (tags.place && AREA_PLACES.has(tags.place)) {
    if (SOCIETY_NAME.test(name)) return "residence";
    return JUNCTION_NAME.test(name) ? "landmark" : "area";
  }
  if (tags.landuse === "residential" || RESIDENTIAL_BUILDINGS.has(tags.building ?? "")) return "residence";
  if (tags.highway) return "street";
  return "landmark";
}

function query({ south, west, north, east }: BBox): string {
  return `[out:json][timeout:300][bbox:${south},${west},${north},${east}];
(
  nwr["place"~"^(suburb|neighbourhood|quarter|locality|village|hamlet|town)$"]["name"];
  nwr["landuse"~"^(residential|commercial|retail|industrial)$"]["name"];
  nwr["building"~"^(apartments|residential|dormitory|house|commercial|office|retail|industrial)$"]["name"];
  nwr["amenity"~"^(school|college|university|kindergarten|place_of_worship|bank|marketplace|cinema|community_centre|library|townhall|courthouse|post_office|bus_station)$"]["name"];
  nwr["leisure"~"^(park|garden|stadium|sports_centre|golf_course)$"]["name"];
  nwr["tourism"~"^(attraction|museum|viewpoint)$"]["name"];
  nwr["office"]["name"];
  nwr["historic"]["name"];
  nwr["aeroway"="aerodrome"]["name"];
  way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"]["name"];
);
out tags center;`;
}

export const fetchOsmPlaceElements = (bbox: BBox): Promise<OverpassElement[]> => fetchOverpass(query(bbox));

const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

function toPlace({ type, id, lat, lon, center, tags }: OverpassElement): NamedPlace[] {
  const name = (tags["name:en"] ?? tags.name)?.trim();
  const latitude = lat ?? center?.lat;
  const longitude = lon ?? center?.lon;
  if (!name || latitude === undefined || longitude === undefined) return [];
  const aliases = ALIAS_TAGS.flatMap((tag) => tags[tag]?.split(";") ?? []).map((alias) => alias.trim());
  const aka = [...new Set(aliases)].filter((alias) => alias && alias !== name);
  return [{ id: `${type[0]}${id}`, name, lon: round(longitude), lat: round(latitude), kind: placeKind(tags, name), ...(aka.length ? { aka } : {}) }];
}

export function toNamedPlaces(elements: readonly OverpassElement[]): NamedPlace[] {
  const candidates = elements.flatMap(toPlace).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const keptByName = new Map<string, NamedPlace[]>();
  return candidates.filter((place) => {
    const key = foldText(place.name);
    const radius = place.kind === "street" ? STREET_MERGE_METERS : MERGE_METERS;
    const kept = keptByName.get(key) ?? [];
    if (kept.some((other) => haversineMeters([other.lon, other.lat], [place.lon, place.lat]) < radius)) return false;
    keptByName.set(key, [...kept, place]);
    return true;
  });
}
