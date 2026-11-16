import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import type { OpenState } from "#src/city/openingHours.js";
import { AppError } from "#src/lib/errors.js";
import type { SafeStops } from "#src/planner/safeStops.js";
import { safeStopProfileSchema, verifyRecord, type SafeStop } from "#src/stops/safeStop.js";
import type { RankedWashroom } from "#src/stops/washrooms.js";

const idParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/) });
const ideasBody = z.object({ name: z.string().trim().min(2).max(60), cityId: z.string().max(40) }).strict();
const nearQuery = z.object({ lon: z.coerce.number().min(-180).max(180), lat: z.coerce.number().min(-90).max(90) });

const ownerView = (stop: SafeStop) => ({
  id: stop.id,
  status: stop.status,
  cityId: stop.cityId,
  profile: stop.profile,
  verify: verifyRecord(stop.profile.domain, stop.verifyCode),
  registrar: stop.registrar ?? null,
  verifiedAt: stop.verifiedAt?.toISOString() ?? null,
});

const publicView = (stop: SafeStop, state: OpenState) => ({
  id: stop.id,
  cityId: stop.cityId,
  profile: stop.profile,
  registrar: stop.registrar ?? null,
  verifiedAt: stop.verifiedAt?.toISOString() ?? null,
  open: state.open,
  closesAt: state.closesAt?.toISOString() ?? null,
});

const washroomView = ({ distanceMeters, closesAt, ...washroom }: RankedWashroom) => ({
  ...washroom,
  distanceMeters: Math.round(distanceMeters),
  closesAt: closesAt?.toISOString() ?? null,
});

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  safeStops?: SafeStops;
}

/** Owners edit and verify their listings when signed in; listed stops and washrooms are public. */
export const stopRoutes =
  ({ requireAuth, safeStops }: Deps): FastifyPluginAsync =>
  async (app) => {
    const service = () => {
      if (!safeStops) throw new AppError(503, "NOT_CONFIGURED", "Safe Stops are not configured");
      return safeStops;
    };
    const owner = { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 hour" } } };

    app.get("/stops/mine", { preHandler: requireAuth }, async (req) => ({
      stops: (await service().mine(req.user!.uid)).map(ownerView),
    }));

    app.post("/stops", owner, async (req, reply) => {
      const stop = await service().create(req.user!.uid, safeStopProfileSchema.parse(req.body));
      return reply.status(201).send({ stop: ownerView(stop) });
    });

    app.put("/stops/:id", owner, async (req) => {
      const { id } = idParams.parse(req.params);
      return { stop: ownerView(await service().update(req.user!.uid, id, safeStopProfileSchema.parse(req.body))) };
    });

    app.post("/stops/:id/verify", owner, async (req) => {
      const { id } = idParams.parse(req.params);
      const { stop, checks } = await service().verify(req.user!.uid, id);
      return { stop: ownerView(stop), checks };
    });

    app.post("/stops/domain-ideas", { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => {
      const { name, cityId } = ideasBody.parse(req.body);
      return { ideas: await service().domainIdeas(name, cityId) };
    });

    app.get("/stops/:id", async (req) => {
      const { id } = idParams.parse(req.params);
      const found = service().listedStop(id);
      if (!found) throw new AppError(404, "STOP_NOT_FOUND", "This Safe Stop isn't listed");
      return { stop: publicView(found.stop, found.state) };
    });

    app.get("/washrooms", async (req) => {
      const { lon, lat } = nearQuery.parse(req.query);
      const { cityId, at, washrooms } = service().washroomsNear([lon, lat]);
      return { cityId, at: at.toISOString(), washrooms: washrooms.map(washroomView) };
    });
  };
