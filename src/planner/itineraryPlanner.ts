/**
 * Application service behind POST /api/itinerary.
 *
 *   plan() → city lookup → candidates near the base → model picks in the line format (see
 *            itinerary/prompt.ts), or none when the model is missing, failing or over budget →
 *            fill empty slots from our ranking → schedule in city time
 *
 * The model sees only place names, areas and tags; nothing about the rider. Spend is summed per UTC
 * day from each reply's cost and the model is skipped once it reaches dailyBudgetUsd. Plans are cached
 * 12 h by city, base (≈100 m), answers and start day, so repeat asks cost nothing; a plan that fell
 * back for a passing reason (model failure, today's budget) is evicted so the next ask retries.
 */
import type { CityIndex } from "#src/city/cityIndex.js";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import { createHoursEvaluator, type HoursEvaluator } from "#src/city/openingHours.js";
import { selectCandidates } from "#src/itinerary/candidates.js";
import { fillGaps } from "#src/itinerary/fill.js";
import { buildPrompt, parseReply, type ParsedReply } from "#src/itinerary/prompt.js";
import { scheduleTrip, tripStart, type ScheduledDay } from "#src/itinerary/schedule.js";
import { dayCount, slotsFor, type TripRequest } from "#src/itinerary/trip.js";
import { AppError } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import { TtlCache } from "#src/lib/ttlCache.js";
import type { TextModel } from "#src/planner/ports.js";

export type FallbackReason = "not_configured" | "unavailable" | "daily_limit";

export interface Itinerary {
  readonly city: CityIndex;
  readonly trip: TripRequest;
  readonly title: string;
  readonly source: "ai" | "basic";
  readonly fallback?: { readonly reason: FallbackReason; readonly upstreamStatus?: number };
  readonly days: readonly ScheduledDay[];
}

export interface ItineraryPlanner {
  plan(trip: TripRequest): Promise<Itinerary>;
}

export interface ItineraryPlannerDeps {
  readonly cities: CityRegistry;
  readonly model?: TextModel;
  readonly dailyBudgetUsd?: number;
  readonly now?: () => Date;
}

const CACHE_TTL_MS = 12 * 60 * 60_000;
const CACHE_ENTRIES = 300;

function basicTitle(trip: TripRequest): string {
  const place = trip.base.name.split(",")[0]!.trim();
  if (trip.days === 0.5) return `Half a day around ${place}`;
  return trip.days === 1 ? `A day around ${place}` : `${trip.days} days around ${place}`;
}

export function createItineraryPlanner({ cities, model, dailyBudgetUsd = 1, now = () => new Date() }: ItineraryPlannerDeps): ItineraryPlanner {
  const cache = new TtlCache<string, Promise<Itinerary>>(CACHE_TTL_MS, CACHE_ENTRIES);
  const hoursByCity = new Map<string, HoursEvaluator>(
    cities.cities.map((c) => [c.id, createHoursEvaluator(c.data.center, c.data.utcOffsetMinutes)]),
  );
  let spendDay = "";
  let spentUsd = 0;
  const spentToday = () => {
    const day = now().toISOString().slice(0, 10);
    if (day !== spendDay) {
      spendDay = day;
      spentUsd = 0;
    }
    return spentUsd;
  };

  const build = async (city: CityIndex, trip: TripRequest, startAt: Date): Promise<Itinerary> => {
    const candidates = selectCandidates(city, trip);
    if (candidates.length === 0) {
      throw new AppError(422, "NO_PLACES", "There are not enough places near here to plan a trip");
    }
    const days = dayCount(trip.days);
    const slots = slotsFor(trip);

    let reply: ParsedReply = { picks: [] };
    let fallback: Itinerary["fallback"];
    if (!model) fallback = { reason: "not_configured" };
    else if (spentToday() >= dailyBudgetUsd) fallback = { reason: "daily_limit" };
    else {
      try {
        const { text, costUsd } = await model.complete(buildPrompt(trip, slots, candidates));
        spentToday();
        spentUsd += costUsd;
        reply = parseReply(text, candidates, days, slots);
        if (reply.picks.length === 0) fallback = { reason: "unavailable" };
      } catch (err) {
        fallback = { reason: "unavailable", ...(err instanceof UpstreamError && err.status ? { upstreamStatus: err.status } : {}) };
      }
    }

    const picks = fillGaps(reply.picks, candidates, days, slots, trip.base.point);
    const scheduled = scheduleTrip(picks, {
      trip,
      startAt,
      days,
      utcOffsetMinutes: city.data.utcOffsetMinutes,
      hours: hoursByCity.get(city.id) ?? createHoursEvaluator(city.data.center, city.data.utcOffsetMinutes),
      candidates,
    });
    return {
      city,
      trip,
      title: reply.title ?? basicTitle(trip),
      source: fallback ? "basic" : "ai",
      ...(fallback ? { fallback } : {}),
      days: scheduled,
    };
  };

  return {
    plan(trip) {
      const city = cities.locate(trip.base.point);
      if (!city) {
        const names = cities.cities.map((c) => c.data.name).join(" and ");
        return Promise.reject(new AppError(422, "OUTSIDE_COVERAGE", `Pick a starting point inside ${names || "a covered city"}`));
      }
      const startAt = tripStart(now(), city.data.utcOffsetMinutes);
      const key = [
        city.id,
        trip.base.point.map((v) => v.toFixed(3)).join(","),
        trip.base.name.toLowerCase(),
        trip.days,
        [...trip.interests].sort().join(","),
        trip.diet,
        trip.backBy,
        startAt.toISOString(),
      ].join("|");
      const cached = cache.get(key);
      if (cached) return cached;
      const pending = build(city, trip, startAt);
      cache.set(key, pending);
      pending.then(
        (plan) => plan.fallback && plan.fallback.reason !== "not_configured" && cache.delete(key),
        () => cache.delete(key),
      );
      return pending;
    },
  };
}
