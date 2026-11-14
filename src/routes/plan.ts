import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError, badRequest } from "../lib/errors.js";
import type { RoutePlanner } from "../planner/routePlanner.js";
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, optionsSchema, weightsSchema } from "../safety/parameters.js";
import { toPlanResponse } from "./planResponse.js";

const MAX_PAST_MS = 60 * 60_000;
const MAX_FUTURE_MS = 14 * 24 * 60 * 60_000;

const lngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const scoringBody = {
  weights: weightsSchema.default(DEFAULT_WEIGHTS),
  options: optionsSchema.default(DEFAULT_OPTIONS),
};
const planBody = z
  .object({
    from: lngLatSchema,
    to: lngLatSchema,
    departAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    ...scoringBody,
  })
  .strict();
const rescoreBody = z.object(scoringBody).strict();
const searchParams = z.object({ searchId: z.uuid() });

/** Public on purpose: a rider must never need an account to find a safer way home. */
export const planRoutes =
  ({ planner, now = () => new Date() }: { planner?: RoutePlanner; now?: () => Date }): FastifyPluginAsync =>
  async (app) => {
    const requirePlanner = () => {
      if (!planner) throw new AppError(503, "NOT_CONFIGURED", "Route planning is not configured");
      return planner;
    };

    app.post("/plan", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
      const { departAt, ...body } = planBody.parse(req.body);
      if (departAt) {
        const offset = departAt.getTime() - now().getTime();
        if (offset < -MAX_PAST_MS || offset > MAX_FUTURE_MS) throw badRequest("Departure must be within the next 14 days");
      }
      return toPlanResponse(await requirePlanner().plan({ ...body, ...(departAt ? { departAt } : {}) }));
    });

    app.post("/plan/:searchId/score", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
      const { searchId } = searchParams.parse(req.params);
      const { weights, options } = rescoreBody.parse(req.body ?? {});
      return toPlanResponse(requirePlanner().rescore(searchId, weights, options));
    });
  };
