import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Firestore } from "firebase-admin/firestore";
import { ZodError } from "zod";
import { createAuthGuard } from "#src/auth/guard.js";
import type { TokenVerifier } from "#src/auth/tokenVerifier.js";
import { createCityRegistry, type CityRegistry } from "#src/city/cityRegistry.js";
import type { Env } from "#src/config/env.js";
import type { PreferencesStore } from "#src/db/preferencesStore.js";
import type { GoDaddyClient } from "#src/integrations/godaddy/client.js";
import { GoDaddyApiError } from "#src/integrations/godaddy/client.js";
import { AppError } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import type { CommunityReports } from "#src/planner/communityReports.js";
import type { ItineraryPlanner } from "#src/planner/itineraryPlanner.js";
import { createPlaceSuggester } from "#src/planner/placeSuggester.js";
import type { Geocoder } from "#src/planner/ports.js";
import type { RideBooking } from "#src/planner/rideBooking.js";
import type { RoutePlanner } from "#src/planner/routePlanner.js";
import type { SafeStops } from "#src/planner/safeStops.js";
import { configRoutes } from "#src/routes/config.js";
import { domainRoutes } from "#src/routes/domains.js";
import { healthRoutes } from "#src/routes/health.js";
import { itineraryRoutes } from "#src/routes/itinerary.js";
import { meRoutes } from "#src/routes/me.js";
import { placesRoutes } from "#src/routes/places.js";
import { planRoutes } from "#src/routes/plan.js";
import { reportRoutes } from "#src/routes/reports.js";
import { rideRoutes, SESSION_HEADER } from "#src/routes/rides.js";
import { stopRoutes } from "#src/routes/stops.js";
import { serveWebApp, webAppCsp } from "#src/routes/webApp.js";

export interface AppDeps {
  env: Env;
  verifier: TokenVerifier;
  godaddy?: GoDaddyClient;
  db?: Firestore;
  cities?: CityRegistry;
  planner?: RoutePlanner;
  itineraries?: ItineraryPlanner;
  geocoder?: Geocoder;
  preferences?: PreferencesStore;
  reports?: CommunityReports;
  rides?: RideBooking;
  safeStops?: SafeStops;
  now?: () => Date;
  webRoot?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials.
      redact: ["req.headers.authorization", "req.headers.cookie", `req.headers["${SESSION_HEADER}"]`],
    },
    trustProxy: true, // correct client IPs behind Render/Fly/Cloud Run proxies (rate limiting)
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: webAppCsp },
    // Google sign-in reports back to the page from its popup window.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  });
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
    if (err instanceof UpstreamError) {
      req.log.error({ service: err.service, upstreamStatus: err.status, upstreamCode: (err as { code?: unknown }).code }, "upstream error");
      return reply.status(502).send({ error: { code: "UPSTREAM_ERROR", message: `${err.service} is unavailable` } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "REQUEST_ERROR", message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  const requireAuth = createAuthGuard(deps.verifier);
  const cities = deps.cities ?? createCityRegistry([]);

  await app.register(healthRoutes);
  await app.register(meRoutes({ requireAuth, db: deps.db, preferences: deps.preferences }), { prefix: "/api" });
  await app.register(domainRoutes({ requireAuth, godaddy: deps.godaddy }), { prefix: "/api" });
  await app.register(configRoutes(cities, deps.rides), { prefix: "/api" });
  await app.register(
    placesRoutes({ cities, suggester: createPlaceSuggester(deps.geocoder), ...(deps.geocoder ? { geocoder: deps.geocoder } : {}) }),
    { prefix: "/api" },
  );
  await app.register(planRoutes({ ...(deps.planner ? { planner: deps.planner } : {}), ...(deps.now ? { now: deps.now } : {}) }), {
    prefix: "/api",
  });
  await app.register(itineraryRoutes({ ...(deps.itineraries ? { planner: deps.itineraries } : {}) }), { prefix: "/api" });
  await app.register(reportRoutes({ requireAuth, ...(deps.reports ? { reports: deps.reports } : {}) }), { prefix: "/api" });
  await app.register(rideRoutes({ ...(deps.rides ? { rides: deps.rides } : {}) }), { prefix: "/api" });
  await app.register(stopRoutes({ requireAuth, ...(deps.safeStops ? { safeStops: deps.safeStops } : {}) }), { prefix: "/api" });
  if (deps.webRoot) await serveWebApp(app, deps.webRoot);

  return app;
}
