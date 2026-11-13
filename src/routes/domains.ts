import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import type { GoDaddyClient } from "../integrations/godaddy/client.js";
import { checkDomainAvailability } from "../integrations/godaddy/domains.js";
import { AppError } from "../lib/errors.js";

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  godaddy?: GoDaddyClient;
}

const query = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, "Not a valid domain name"),
});

export const domainRoutes =
  ({ requireAuth, godaddy }: Deps): FastifyPluginAsync =>
  async (app) => {
    app.get("/domains/availability", { preHandler: requireAuth }, async (req) => {
      if (!godaddy) throw new AppError(503, "NOT_CONFIGURED", "GoDaddy integration is not configured");
      const { domain } = query.parse(req.query);
      return checkDomainAvailability(godaddy, domain);
    });
  };
