/**
 * Type-ahead search over a city's named places: housing societies, areas, landmarks, streets and the
 * named POIs used for scoring. It runs in memory on every keystroke, so it answers in a few milliseconds.
 *
 * Text is folded to lowercase words without accents or punctuation. A place matches when every query
 * word pairs with a different word of one of its names: exactly, as a prefix (the last word is still
 * being typed), by sound, or within one typo per four letters, at most two (optimal string alignment
 * distance). The sound key absorbs how Indian names are transliterated: any vowel run is one vowel,
 * w = v, z = j, the h of bh/ch/dh/kh/ph/sh/th is dropped and doubled letters collapse, so "Pruthvi"
 * finds "Prithvi" and "Hinjewadi" finds "Hinjawadi". Sound keys and typos keep the first letter's
 * class, which lets us skip places whose word initials don't fit. Typing without spaces
 * ("blueridge") matches the name with its spaces removed.
 *
 * rank = 100 × mean word quality + start bonus + kind weight − cost per unmatched name word
 *        − alias cost − distance cost
 * Word quality is 1 for an exact word or a prefix of the last word, 0.9 for a prefix of an earlier
 * word, 0.85 for a sound-alike and 0.8 for a typo, so spelling variants stay near the top.
 * A place found by an alias is shown under that alias ("Baner Road" for Gopal Hari Deshmukh Marg),
 * with the official name in the label. Same-shown-name places within MERGE_METERS (streets:
 * STREET_MERGE_METERS) collapse into the best ranked one, since OSM maps a society as a compound plus
 * each tower and a street as many ways.
 */
import { haversineMeters, type LngLat } from "../geo/geometry.js";
import type { CityData, PlaceKind } from "./cityData.js";

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly point: LngLat;
  readonly kind: PlaceKind;
}

interface Words {
  readonly words: readonly string[];
  readonly sounds: readonly string[];
}

interface NameVariant extends Words {
  readonly text: string;
  readonly compact: string;
  readonly initials: string;
}

interface Entry {
  readonly id: string;
  readonly key: string;
  readonly point: LngLat;
  readonly kind: PlaceKind;
  readonly weight: number;
  readonly variants: readonly NameVariant[];
}

interface Match {
  readonly quality: number;
  readonly leading: boolean;
  readonly extraWords: number;
}

interface Hit {
  readonly entry: Entry;
  readonly shownName: string;
  readonly rank: number;
}

const KIND_WEIGHT: Readonly<Record<PlaceKind, number>> = { area: 10, residence: 8, street: 5, landmark: 4 };
const POI_WEIGHT = 3;
const LEADING_BONUS = 20;
const EXTRA_WORD_COST = 3;
const MAX_EXTRA_WORDS = 4;
const ALIAS_COST = 2;
const DISTANCE_COST_PER_KM = 0.5;
const MAX_DISTANCE_COST = 10;
const MERGE_METERS = 600;
const STREET_MERGE_METERS = 2000;
const AREA_LABEL_METERS = 5000;
const MAX_NAME_WORDS = 30;

export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

export const isSamePlace = (a: Pick<Place, "name" | "point">, b: Pick<Place, "name" | "point">): boolean =>
  foldText(a.name) === foldText(b.name) && haversineMeters(a.point, b.point) < MERGE_METERS;

const spoken = (text: string) => toWords(text).sounds.join(" ");

/** Whether `typed` reads like the start of `name`, up to transliteration ("kumar pruth" → Kumar Prithvi). */
export const startsLike = (name: string, typed: string): boolean => spoken(name).startsWith(spoken(typed));

const soundKey = (word: string) =>
  word
    .replace(/([bcdgkpst])h/g, "$1")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/[aeiou]+/g, "a")
    .replace(/(.)\1+/g, "$1");

function toWords(text: string): Words {
  const words = foldText(text).split(" ").filter(Boolean).slice(0, MAX_NAME_WORDS);
  return { words, sounds: words.map(soundKey) };
}

const typoBudget = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) distance = Math.min(distance, before[j - 2]! + 1);
      row.push(distance);
    }
    if (Math.min(...row) > max) return max + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length]!;
}

function wordQuality(query: string, querySound: string, word: string, wordSound: string, typing: boolean): number {
  if (word === query) return 1;
  if (word.startsWith(query)) return typing ? 1 : 0.9;
  if (typing ? wordSound.startsWith(querySound) : wordSound === querySound) return 0.85;
  const budget = typoBudget(query.length);
  if (budget === 0 || word[0] !== query[0]) return 0;
  if (!typing) return editDistance(query, word, budget) <= budget ? 0.8 : 0;
  for (let length = query.length - 1; length <= Math.min(word.length, query.length + 1); length++) {
    if (editDistance(query, word.slice(0, length), budget) <= budget) return 0.8;
  }
  return 0;
}

function matchVariant(variant: NameVariant, query: Words, compact: string): Match | undefined {
  const { words, sounds } = query;
  const extraWords = Math.max(0, variant.words.length - words.length);
  if (compact.length >= 3 && variant.compact.startsWith(compact)) return { quality: 1, leading: true, extraWords };
  if (sounds.some((sound) => !variant.initials.includes(sound[0]!))) return undefined;
  let used = 0;
  let total = 0;
  let leading = false;
  for (const [i, typed] of words.entries()) {
    let best = 0;
    let bestIndex = -1;
    for (const [j, word] of variant.words.entries()) {
      if (used & (1 << j)) continue;
      const quality = wordQuality(typed, sounds[i]!, word, variant.sounds[j]!, i === words.length - 1);
      if (quality > best) {
        best = quality;
        bestIndex = j;
        if (quality === 1) break;
      }
    }
    if (bestIndex < 0) return undefined;
    used |= 1 << bestIndex;
    total += best;
    if (i === 0 && bestIndex === 0) leading = true;
  }
  return { quality: total / words.length, leading, extraWords };
}

const matchRank = (match: Match) =>
  100 * match.quality + (match.leading ? LEADING_BONUS : 0) - EXTRA_WORD_COST * Math.min(MAX_EXTRA_WORDS, match.extraWords);

function bestName(entry: Entry, query: Words, compact: string): { shownName: string; rank: number } | undefined {
  let best: { shownName: string; rank: number } | undefined;
  for (const [i, variant] of entry.variants.entries()) {
    const match = matchVariant(variant, query, compact);
    if (!match) continue;
    const rank = matchRank(match) - (i > 0 ? ALIAS_COST : 0);
    if (!best || rank > best.rank) best = { shownName: variant.text, rank };
  }
  return best;
}

function nameVariant(text: string): NameVariant | undefined {
  const { words, sounds } = toWords(text);
  if (words.length === 0) return undefined;
  return { text, words, sounds, compact: words.join(""), initials: sounds.map((s) => s[0]).join("") };
}

function entry(id: string, name: string, point: LngLat, kind: PlaceKind, weight: number, aka: readonly string[] = []): Entry[] {
  const variants = [name, ...aka].flatMap((n) => nameVariant(n) ?? []);
  return variants.length ? [{ id, key: foldText(name), point, kind, weight, variants }] : [];
}

/** In-memory type-ahead index over one city's named places and named POIs. */
export class PlaceSearch {
  readonly #entries: readonly Entry[];
  readonly #areas: readonly Entry[];

  constructor(private readonly city: Pick<CityData, "name" | "center" | "places" | "pois">) {
    this.#entries = [
      ...city.places.flatMap((p) => entry(p.id, p.name, [p.lon, p.lat], p.kind, KIND_WEIGHT[p.kind], p.aka)),
      ...city.pois.flatMap((p) => (p.name ? entry(p.id, p.name, [p.lon, p.lat], "landmark", POI_WEIGHT) : [])),
    ];
    this.#areas = this.#entries.filter((e) => e.kind === "area");
  }

  search(text: string, near: LngLat = this.city.center, limit = 8): Place[] {
    const query = toWords(text);
    if (query.words.length === 0) return [];
    const compact = query.words.join("");
    const hits: Hit[] = [];
    for (const entry of this.#entries) {
      const best = bestName(entry, query, compact);
      if (!best) continue;
      const distanceCost = Math.min(MAX_DISTANCE_COST, (haversineMeters(near, entry.point) / 1000) * DISTANCE_COST_PER_KM);
      hits.push({ entry, shownName: best.shownName, rank: best.rank + entry.weight - distanceCost });
    }
    hits.sort((a, b) => b.rank - a.rank);

    const picked: Hit[] = [];
    for (const hit of hits) {
      if (picked.length === limit) break;
      const radius = hit.entry.kind === "street" ? STREET_MERGE_METERS : MERGE_METERS;
      const key = foldText(hit.shownName);
      if (!picked.some((p) => foldText(p.shownName) === key && haversineMeters(p.entry.point, hit.entry.point) < radius)) picked.push(hit);
    }
    return picked.map((hit) => this.#toPlace(hit));
  }

  #toPlace({ entry, shownName }: Hit): Place {
    const officialName = entry.variants[0]!.text;
    const area = entry.kind === "area" ? undefined : this.#nearestArea(entry);
    const parts = [shownName, ...(officialName === shownName ? [] : [officialName]), ...(area ? [area] : []), this.city.name];
    return { id: entry.id, name: shownName, label: parts.join(", "), point: entry.point, kind: entry.kind };
  }

  #nearestArea(entry: Entry): string | undefined {
    let nearest: Entry | undefined;
    let nearestMeters = AREA_LABEL_METERS;
    for (const area of this.#areas) {
      const meters = haversineMeters(area.point, entry.point);
      if (meters < nearestMeters && !entry.key.includes(area.key)) {
        nearest = area;
        nearestMeters = meters;
      }
    }
    return nearest?.variants[0]!.text;
  }
}
