/**
 * The real places an itinerary may use: sights and eateries within reach of the rider's base, filtered
 * by interests and diet, ranked by our own signals and capped so the AI prompt stays small. The AI
 * chooses only from this list, and the same ranking fills any slot it leaves empty.
 *
 * Reach grows with trip length (REACH_KM): more days can spread over more of the city.
 * Sight rank  = 3 if famous + 2 if it matches an interest + 0.5 for museums, heritage and attractions
 *               − 0.2 per km from base.
 * Eatery rank = 2 for a cafe when the rider likes cafes, 1 for a restaurant when they like food,
 *               1.5 for a vegetarian name when they eat veg, 0.3 if OSM has its hours (a sign someone
 *               maintains it), −0.5 for fast food, − 0.25 per km from the base or the nearest offered
 *               sight, whichever is closer, so there is food near every sight, not only near the base.
 * OSM rarely tags cuisine or diet here, so diet uses the name: meat words drop a place for veg and
 * egg riders, egg words also for veg riders, vegetarian words ("pure veg", "Udupi", "Darshini",
 * "Bhavan") mark it veg. National chains are left out because riders ask for the local best. Places
 * of worship without a famous link are offered only to riders who picked temples. The same place
 * mapped twice (same name once folded and doubled letters collapsed, within DUPLICATE_METERS) is
 * offered once.
 */
import type { CityIndex } from "../city/cityIndex.js";
import type { PoiCategory, SightKind } from "../city/cityData.js";
import type { HoursSubject } from "../city/openingHours.js";
import { foldText } from "../city/placeSearch.js";
import { haversineMeters, type LngLat } from "../geo/geometry.js";
import type { Interest, TripDays, TripRequest } from "./trip.js";

export type CandidateType = "eat" | "see";
export type EateryKind = Extract<PoiCategory, "restaurant" | "cafe" | "fast_food">;

export interface Candidate {
  readonly ref: number;
  readonly id: string;
  readonly name: string;
  readonly point: LngLat;
  readonly area?: string;
  readonly type: CandidateType;
  readonly kind: SightKind | EateryKind;
  readonly famous: boolean;
  readonly veg: boolean;
  readonly hours: HoursSubject;
  readonly rank: number;
}

const REACH_KM: Record<TripDays, number> = { 0.5: 6, 1: 8, 2: 12, 3: 15 };
const MAX_SIGHTS = 80;
const MAX_EATERIES = 320;
const MAX_NAME_LENGTH = 60;
const EATERY_KINDS: ReadonlySet<PoiCategory> = new Set(["restaurant", "cafe", "fast_food"]);
const INTEREST_SIGHTS: Partial<Record<Interest, readonly SightKind[]>> = {
  heritage: ["heritage", "museum"],
  temples: ["worship"],
  nature: ["nature"],
  markets: ["market"],
};
const MEAT_NAME = /chicken|mutton|biryani|kebab|kabab|fish|sea ?food|meat|non[ -]?veg|bbq|barbe?que|shawarma|prawn|shrimp|lobster|crab|pork|beef/i;
const EGG_NAME = /\b(egg|eggs|omelette?|anda)\b/i;
const VEG_NAME = /\b(pure ?veg|veg|vegetarian|udupi|darshini|bhavan|shakahari|jain)\b/i;
const DUPLICATE_METERS = 250;
const CHAIN_NAME =
  /mcdonald|kfc|domino|pizza hut|subway|burger king|starbucks|cafe coffee day|\bccd\b|barista|dunkin|taco bell|baskin|wow!? ?momo|haldiram|faasos|behrouz|box8|chaayos|tim hortons|costa coffee/i;

const cleanName = (name: string) => name.replace(/[|\n\r]+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
const top = <T extends { rank: number; name: string; point: LngLat }>(items: T[], limit: number) =>
  withoutDuplicates(items.sort((a, b) => b.rank - a.rank)).slice(0, limit);
const sameNameKey = (name: string) => foldText(name).replace(/\s+/g, "").replace(/(.)\1+/g, "$1");

function withoutDuplicates<T extends { name: string; point: LngLat }>(ranked: readonly T[]): T[] {
  const kept = new Map<string, LngLat[]>();
  return ranked.filter((item) => {
    const key = sameNameKey(item.name);
    const points = kept.get(key) ?? [];
    if (points.some((p) => haversineMeters(p, item.point) < DUPLICATE_METERS)) return false;
    kept.set(key, [...points, item.point]);
    return true;
  });
}

export function selectCandidates(city: CityIndex, trip: TripRequest): Candidate[] {
  const reachMeters = REACH_KM[trip.days] * 1000;
  const km = (point: LngLat) => haversineMeters(trip.base.point, point) / 1000;
  const wanted = new Set(trip.interests.flatMap((interest) => INTEREST_SIGHTS[interest] ?? []));
  const anyKind = wanted.size === 0;

  const sights = city.data.sights.flatMap((sight) => {
    const point: LngLat = [sight.lon, sight.lat];
    const distance = km(point);
    const famous = Boolean(sight.famous);
    if (distance * 1000 > reachMeters) return [];
    if (sight.kind === "worship" && !famous && !wanted.has("worship")) return [];
    const matches = wanted.has(sight.kind);
    if (!anyKind && !matches && !famous && sight.kind !== "attraction") return [];
    const rank =
      (famous ? 3 : 0) + (matches ? 2 : 0) + (["museum", "heritage", "attraction"].includes(sight.kind) ? 0.5 : 0) - 0.2 * distance;
    return [{ id: sight.id, name: cleanName(sight.name), point, kind: sight.kind, famous, veg: false, rank, hours: { cat: sight.kind, hours: sight.hours } }];
  });

  const offeredSights = top(sights, MAX_SIGHTS);
  const anchors = [trip.base.point, ...offeredSights.map((s) => s.point)];
  const kmFromNearestAnchor = (point: LngLat) => Math.min(...anchors.map((a) => haversineMeters(a, point))) / 1000;
  const likes = new Set(trip.interests);
  const eateries = city.poisWithin(trip.base.point, reachMeters).flatMap(({ poi }) => {
    if (!poi.name || !EATERY_KINDS.has(poi.cat) || CHAIN_NAME.test(poi.name)) return [];
    if (trip.diet !== "any" && MEAT_NAME.test(poi.name)) return [];
    if (trip.diet === "veg" && EGG_NAME.test(poi.name)) return [];
    const kind = poi.cat as EateryKind;
    const veg = VEG_NAME.test(poi.name);
    const point: LngLat = [poi.lon, poi.lat];
    const rank =
      (kind === "cafe" && likes.has("cafes") ? 2 : 0) +
      (kind === "restaurant" && likes.has("food") ? 1 : 0) +
      (veg && trip.diet === "veg" ? 1.5 : 0) +
      (poi.hours ? 0.3 : 0) -
      (kind === "fast_food" ? 0.5 : 0) -
      0.25 * kmFromNearestAnchor(point);
    return [{ id: poi.id, name: cleanName(poi.name), point, kind, famous: false, veg, rank, hours: { cat: poi.cat, hours: poi.hours } }];
  });

  const chosen = [
    ...offeredSights.map((s) => ({ ...s, type: "see" as const })),
    ...top(eateries, MAX_EATERIES).map((e) => ({ ...e, type: "eat" as const })),
  ];
  return chosen.map((c, i) => {
    const area = city.places.areaNear(c.point, c.name);
    return { ...c, ref: i + 1, ...(area ? { area } : {}) };
  });
}
