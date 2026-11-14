import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { CommunityReports } from "../planner/communityReports.js";
import { REPORT_CATEGORIES, REPORT_WHEN } from "../safety/community.js";

const reportBody = z
  .object({
    point: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    category: z.enum(REPORT_CATEGORIES),
    when: z.enum(REPORT_WHEN).default("now"),
  })
  .strict();

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  reports?: CommunityReports;
}

/** Signed-in only, so every report traces to an account for rate limiting, though it is stored without one. */
export const reportRoutes =
  ({ requireAuth, reports }: Deps): FastifyPluginAsync =>
  async (app) => {
    app.post("/reports", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
      if (!reports) throw new AppError(503, "NOT_CONFIGURED", "Rider reports are not configured");
      const { category, point, observedAt } = await reports.submit(req.user!.uid, reportBody.parse(req.body));
      return reply.status(201).send({ report: { category, point, observedAt: observedAt.toISOString() } });
    });
  };
