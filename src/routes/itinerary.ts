import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { LngLat } from "../geo/geometry.js";
import { BACK_BY, DIETS, INTERESTS, TRIP_DAYS } from "../itinerary/trip.js";
import { AppError } from "../lib/errors.js";
import type { Itinerary, ItineraryPlanner } from "../planner/itineraryPlanner.js";
import { lngLatSchema } from "./schemas.js";

const MAX_INTERESTS = 3;

const tripBody = z
  .object({
    base: z.object({
      name: z
        .string()
        .max(80)
        .transform((name) => name.replace(/[\r\n|]+/g, " ").trim())
        .pipe(z.string().min(1)),
      point: lngLatSchema,
    }),
    days: z.literal(TRIP_DAYS),
    interests: z
      .array(z.enum(INTERESTS))
      .max(MAX_INTERESTS)
      .default([])
      .transform((list) => [...new Set(list)]),
    diet: z.enum(DIETS).default("any"),
    backBy: z.enum(BACK_BY).default("sunset"),
  })
  .strict();

const roundPoint = ([lon, lat]: LngLat): LngLat => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];

function toItineraryResponse(plan: Itinerary) {
  return {
    title: plan.title,
    source: plan.source,
    fallback: plan.fallback?.reason ?? null,
    city: { id: plan.city.id, name: plan.city.data.name, utcOffsetMinutes: plan.city.data.utcOffsetMinutes },
    base: { name: plan.trip.base.name, point: roundPoint(plan.trip.base.point) },
    days: plan.days.map((day) => ({
      index: day.index,
      startAt: day.startAt.toISOString(),
      endAt: day.endAt.toISOString(),
      dusk: day.dusk.toISOString(),
      stops: day.stops.map(({ slot, candidate, note, arriveAt, leaveAt, closesAt }) => ({
        id: candidate.id,
        slot,
        name: candidate.name,
        area: candidate.area ?? null,
        kind: candidate.kind,
        famous: candidate.famous,
        point: roundPoint(candidate.point),
        arriveAt: arriveAt.toISOString(),
        leaveAt: leaveAt.toISOString(),
        closesAt: closesAt?.toISOString() ?? null,
        note: note ?? null,
      })),
      legs: day.legs.map((leg) => ({
        from: roundPoint(leg.from),
        to: roundPoint(leg.to),
        departAt: leg.departAt.toISOString(),
        arriveAt: leg.arriveAt.toISOString(),
        distanceMeters: leg.distanceMeters,
        dark: leg.dark,
      })),
    })),
  };
}

/** Public like route planning; each ask costs at most one small model call, bounded per IP and per day. */
export const itineraryRoutes =
  ({ planner }: { planner?: ItineraryPlanner }): FastifyPluginAsync =>
  async (app) => {
    app.post("/itinerary", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req) => {
      if (!planner) throw new AppError(503, "NOT_CONFIGURED", "Trip planning is not configured");
      const plan = await planner.plan(tripBody.parse(req.body));
      if (plan.fallback && plan.fallback.reason !== "not_configured") {
        req.log.warn({ reason: plan.fallback.reason, upstreamStatus: plan.fallback.upstreamStatus }, "trip assistant fell back to the basic plan");
      }
      return toItineraryResponse(plan);
    });
  };
