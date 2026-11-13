import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Firestore } from "firebase-admin/firestore";
import { ZodError } from "zod";
import { createAuthGuard } from "./auth/guard.js";
import type { TokenVerifier } from "./auth/tokenVerifier.js";
import type { Env } from "./config/env.js";
import type { GoDaddyClient } from "./integrations/godaddy/client.js";
import { GoDaddyApiError } from "./integrations/godaddy/client.js";
import { AppError } from "./lib/errors.js";
import { domainRoutes } from "./routes/domains.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

export interface AppDeps {
  env: Env;
  verifier: TokenVerifier;
  godaddy?: GoDaddyClient;
  db?: Firestore;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true, // correct client IPs behind Render/Fly/Cloud Run proxies (rate limiting)
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: "Invalid request", details: err.issues },
      });
    }
    if (err instanceof GoDaddyApiError) {
      // Upstream 401/403 mean OUR server credential is wrong - not the caller's. Surface as 502.
      req.log.error({ upstreamStatus: err.status, upstreamCode: err.code }, "GoDaddy API error");
      const status = err.status === 429 ? 503 : 502;
      return reply.status(status).send({
        error: { code: "UPSTREAM_ERROR", message: "GoDaddy API request failed" },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "REQUEST_ERROR", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  const requireAuth = createAuthGuard(deps.verifier);

  await app.register(healthRoutes);
  await app.register(meRoutes({ requireAuth, db: deps.db }), { prefix: "/api" });
  await app.register(domainRoutes({ requireAuth, godaddy: deps.godaddy }), { prefix: "/api" });

  return app;
}
