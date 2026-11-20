/**
 * Safe Stop listings: vendors create and edit them, prove their GoDaddy domain, and listed
 * stops reach riders as route safety stops and in "washrooms near me".
 *
 * Drafts live only in Firestore. Listed stops are also held in memory, loaded at start-up
 * and updated on every change, so planning never waits on the database. Changing a stop's
 * domain takes it back to draft with a new code; other edits keep it listed. Per account:
 * 5 stops and 20 verification attempts an hour (each runs a DNS and an RDAP lookup).
 *
 * Domain ideas: a name the registries (RDAP) know is taken, whatever GoDaddy's sandbox
 * says. Otherwise GoDaddy's availability API decides when configured (OTE by default;
 * production needs an account with 50+ domains), and the registry's "not registered"
 * when it isn't or refuses. Answers are cached for an hour.
 */
import { randomBytes } from "node:crypto";
import type { Poi } from "#src/city/cityData.js";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import { createHoursEvaluator, type HoursEvaluator, type OpenState } from "#src/city/openingHours.js";
import type { SafeStopStore } from "#src/db/safeStopStore.js";
import type { LngLat } from "#src/geo/geometry.js";
import type { GoDaddyClient } from "#src/integrations/godaddy/client.js";
import { checkDomainAvailability } from "#src/integrations/godaddy/domains.js";
import { AppError } from "#src/lib/errors.js";
import { TtlCache } from "#src/lib/ttlCache.js";
import { domainIdeas, goDaddySearchUrl, isGoDaddyRegistrar, osmHours, verifyRecord, type SafeStop, type SafeStopProfile } from "#src/stops/safeStop.js";
import { fuelStation, publicWashroom, rankWashrooms, safeStopWashroom, WASHROOM_SEARCH_METERS, type RankedWashroom } from "#src/stops/washrooms.js";
import type { DomainLookup, SafeStopSource } from "#src/planner/ports.js";

const HOUR_MS = 3_600_000;
const MAX_STOPS_PER_OWNER = 5;
const VERIFY_ATTEMPTS_PER_HOUR = 20;

export interface DomainIdea {
  readonly domain: string;
  readonly available: boolean | null;
  readonly buyUrl: string;
}

export interface VerifyChecks {
  readonly codeFound: boolean;
  readonly registrar: string | null;
  readonly godaddy: boolean;
}

export interface WashroomsNear {
  readonly cityId: string;
  readonly at: Date;
  readonly washrooms: readonly RankedWashroom[];
}

export interface SafeStops extends SafeStopSource {
  load(): Promise<number>;
  mine(uid: string): Promise<SafeStop[]>;
  create(uid: string, profile: SafeStopProfile): Promise<SafeStop>;
  update(uid: string, id: string, profile: SafeStopProfile): Promise<SafeStop>;
  verify(uid: string, id: string): Promise<{ stop: SafeStop; checks: VerifyChecks }>;
  listedStop(id: string): { stop: SafeStop; state: OpenState } | undefined;
  domainIdeas(shopName: string, cityId: string): Promise<DomainIdea[]>;
  washroomsNear(point: LngLat, at?: Date): WashroomsNear;
}

export interface SafeStopsDeps {
  readonly store: SafeStopStore;
  readonly cities: CityRegistry;
  readonly lookup: DomainLookup;
  readonly godaddy?: GoDaddyClient;
  readonly now?: () => Date;
}

const newId = () => randomBytes(9).toString("base64url");
const newCode = () => randomBytes(8).toString("hex");

const asPoi = ({ id, profile }: SafeStop): Poi => ({
  id: `stop:${id}`,
  lon: profile.point[0],
  lat: profile.point[1],
  cat: "safe_stop",
  name: profile.name,
  hours: osmHours(profile.hours),
});

export function createSafeStops({ store, cities, lookup, godaddy, now = () => new Date() }: SafeStopsDeps): SafeStops {
  const listedStops = new Map<string, SafeStop>();
  const attempts = new TtlCache<string, number[]>(HOUR_MS, 10_000, () => now().getTime());
  const availability = new TtlCache<string, Promise<boolean | null>>(HOUR_MS, 2_000, () => now().getTime());
  const hoursByCity = new Map<string, HoursEvaluator>(
    cities.cities.map((c) => [c.id, createHoursEvaluator(c.data.center, c.data.utcOffsetMinutes)]),
  );
  const coverage = () => cities.cities.map((c) => c.data.name).join(" and ") || "covered cities";

  const remember = (stop: SafeStop) => {
    if (stop.status === "listed") listedStops.set(stop.id, stop);
    else listedStops.delete(stop.id);
  };

  const listedIn = (cityId: string) => [...listedStops.values()].filter((stop) => stop.cityId === cityId);

  const cityAt = (point: LngLat, action: string) => {
    const city = cities.locate(point);
    if (!city) throw new AppError(422, "OUTSIDE_COVERAGE", `${action} works in ${coverage()} only`);
    return city;
  };

  const owned = async (uid: string, id: string) => {
    const stop = await store.get(id);
    if (!stop || stop.ownerUid !== uid) throw new AppError(404, "STOP_NOT_FOUND", "We couldn't find that Safe Stop on your account");
    return stop;
  };

  const takeAttempt = (uid: string) => {
    const clock = now().getTime();
    const recent = (attempts.get(uid) ?? []).filter((t) => clock - t < HOUR_MS);
    if (recent.length >= VERIFY_ATTEMPTS_PER_HOUR) {
      throw new AppError(429, "TOO_MANY_CHECKS", "That's a lot of checks in an hour. DNS changes can take a few minutes, so try again a little later.");
    }
    attempts.set(uid, [...recent, clock]);
  };

  const checkAvailability = async (domain: string): Promise<boolean | null> => {
    const registered = await lookup.registrar(domain).then(
      (registrar) => registrar !== undefined,
      () => undefined,
    );
    if (registered) return false;
    const fromGoDaddy = godaddy ? await checkDomainAvailability(godaddy, domain).catch(() => undefined) : undefined;
    if (fromGoDaddy) return fromGoDaddy.available;
    return registered === false ? true : null;
  };

  const isAvailable = (domain: string) => {
    const cached = availability.get(domain);
    if (cached) return cached;
    const pending = checkAvailability(domain);
    availability.set(domain, pending);
    return pending;
  };

  const stateOf = (stop: SafeStop): OpenState =>
    hoursByCity.get(stop.cityId)?.stateAt({ cat: "safe_stop", hours: osmHours(stop.profile.hours) }, now()) ?? { open: false, estimated: true };

  return {
    async load() {
      const stops = await store.listed();
      stops.forEach(remember);
      return stops.length;
    },

    listed: (cityId) => listedIn(cityId).map(asPoi),

    async mine(uid) {
      return (await store.byOwner(uid)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },

    async create(uid, profile) {
      const city = cityAt(profile.point, "Listing a Safe Stop");
      if ((await store.byOwner(uid)).length >= MAX_STOPS_PER_OWNER) {
        throw new AppError(409, "TOO_MANY_STOPS", `One account can list up to ${MAX_STOPS_PER_OWNER} Safe Stops`);
      }
      const stop: SafeStop = { id: newId(), ownerUid: uid, cityId: city.id, profile, verifyCode: newCode(), status: "draft", updatedAt: now() };
      await store.save(stop);
      return stop;
    },

    async update(uid, id, profile) {
      const current = await owned(uid, id);
      const city = cityAt(profile.point, "Listing a Safe Stop");
      const stop: SafeStop =
        current.profile.domain === profile.domain
          ? { ...current, cityId: city.id, profile, updatedAt: now() }
          : { id, ownerUid: uid, cityId: city.id, profile, verifyCode: newCode(), status: "draft", updatedAt: now() };
      await store.save(stop);
      remember(stop);
      return stop;
    },

    async verify(uid, id) {
      const current = await owned(uid, id);
      takeAttempt(uid);
      const record = verifyRecord(current.profile.domain, current.verifyCode);
      const [values, registrar] = await Promise.all([lookup.txt(record.name), lookup.registrar(current.profile.domain)]);
      const checks: VerifyChecks = {
        codeFound: values.some((value) => value.trim() === record.value),
        registrar: registrar ?? null,
        godaddy: isGoDaddyRegistrar(registrar),
      };
      if (!checks.codeFound || !checks.godaddy || !registrar) return { stop: current, checks };
      const stop: SafeStop = { ...current, status: "listed", registrar, verifiedAt: now(), updatedAt: now() };
      await store.save(stop);
      remember(stop);
      return { stop, checks };
    },

    listedStop(id) {
      const stop = listedStops.get(id);
      return stop && { stop, state: stateOf(stop) };
    },

    async domainIdeas(shopName, cityId) {
      const city = cities.cities.find((c) => c.id === cityId);
      if (!city) throw new AppError(404, "NOT_FOUND", "Unknown city");
      return Promise.all(
        domainIdeas(shopName, city.data.name).map(async (domain) => ({ domain, available: await isAvailable(domain), buyUrl: goDaddySearchUrl(domain) })),
      );
    },

    washroomsNear(point, at = now()) {
      const city = cityAt(point, "Washroom search");
      const hours = hoursByCity.get(city.id)!;
      const candidates = [
        ...listedIn(city.id).flatMap((stop) => safeStopWashroom(stop) ?? []),
        ...city.data.washrooms.map(publicWashroom),
        ...city.poisWithin(point, WASHROOM_SEARCH_METERS).flatMap(({ poi }) => (poi.cat === "fuel" ? [fuelStation(poi)] : [])),
      ];
      return { cityId: city.id, at, washrooms: rankWashrooms(point, at, candidates, (place, instant) => hours.stateAt(place, instant)) };
    },
  };
}
