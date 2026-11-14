/**
 * Place suggestions for the search box. The city's own index answers first: it is instant and knows
 * housing societies, which Pelias does not import. The remote geocoder (~300 ms) only tops up thin
 * answers: fewer than ENOUGH_LOCAL places and none whose name reads like the start of the typed text,
 * since a rider spelling out "Rohan Mith" has already found "Rohan Mithila". That keeps typing fast
 * and the remote quota small. Remote answers are cached per city and query; a failing remote
 * degrades to local results.
 */
import type { CityIndex } from "../city/cityIndex.js";
import { isSamePlace, startsLike } from "../city/placeSearch.js";
import type { LngLat } from "../geo/geometry.js";
import { TtlCache } from "../lib/ttlCache.js";
import type { Geocoder, Place } from "./ports.js";

const LIMIT = 8;
const ENOUGH_LOCAL = 4;
const REMOTE_TTL_MS = 10 * 60_000;
const REMOTE_CACHE_ENTRIES = 1000;

export interface PlaceSuggester {
  suggest(city: CityIndex, text: string, near?: LngLat): Promise<Place[]>;
}

export function createPlaceSuggester(geocoder?: Geocoder): PlaceSuggester {
  const remoteCache = new TtlCache<string, readonly Place[]>(REMOTE_TTL_MS, REMOTE_CACHE_ENTRIES);

  const remote = async (city: CityIndex, text: string): Promise<readonly Place[]> => {
    if (!geocoder) return [];
    const key = `${city.id}:${text.toLowerCase()}`;
    const cached = remoteCache.get(key);
    if (cached) return cached;
    try {
      const places = await geocoder.suggest(text, city.data.center, city.data.bbox);
      remoteCache.set(key, places);
      return places;
    } catch {
      return [];
    }
  };

  return {
    async suggest(city, text, near) {
      const local = city.places.search(text, near, LIMIT);
      if (local.length >= ENOUGH_LOCAL || local.some((place) => startsLike(place.name, text))) return local;
      const extra = (await remote(city, text)).filter((place) => !local.some((known) => isSamePlace(known, place)));
      return [...local, ...extra].slice(0, LIMIT);
    },
  };
}
