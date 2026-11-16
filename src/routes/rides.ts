import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { LngLat } from "#src/geo/geometry.js";
import { AppError } from "#src/lib/errors.js";
import type { NamedPoint, RideBooking, RideQuote, RideView } from "#src/planner/rideBooking.js";
import { scoringBody } from "#src/routes/plan.js";

export const SESSION_HEADER = "x-ny-session";

const linkBody = z.object({ code: z.string().trim().regex(/^\d{1,6}$/, "Enter the digits shown in the Namma Yatri app") }).strict();
const quoteBody = z
  .object({
    searchId: z.uuid(),
    routeId: z.string().regex(/^r\d{1,2}$/),
    mode: z.enum(["live", "demo"]),
    ...scoringBody,
  })
  .strict();
const bookBody = z
  .object({ quoteId: z.uuid(), estimateId: z.string().min(1).max(100), confirm: z.boolean().default(false) })
  .strict();
const rideParams = z.object({ ref: z.uuid() });

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const roundPoint = ([lon, lat]: LngLat): LngLat => [round(lon, 6), round(lat, 6)];
const toPlace = ({ point, name }: NamedPoint) => ({ point: roundPoint(point), name: name ?? null });

function sessionOf(req: FastifyRequest): string | undefined {
  const value = req.headers[SESSION_HEADER];
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
}

function toQuoteResponse(quote: RideQuote) {
  return {
    quoteId: quote.quoteId,
    mode: quote.mode,
    city: { id: quote.city.id, name: quote.city.data.name },
    departAt: quote.departAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    planScore: quote.planScore,
    pickup: toPlace(quote.pickup),
    drop: toPlace(quote.drop),
    checkpoints: quote.checkpoints.map(toPlace),
    options: quote.options.map((option) => ({
      kind: option.kind,
      path: option.shape.map(roundPoint),
      distanceMeters: Math.round(option.distanceMeters),
      durationSeconds: Math.round(option.durationSeconds),
      score: option.score,
      coverage: round(option.coverage, 2),
      estimates: option.estimates.map((e) => ({
        id: e.id,
        tier: e.tier,
        fare: e.fare,
        minFare: e.minFare ?? null,
        maxFare: e.maxFare ?? null,
        pickupSeconds: e.pickupSeconds ?? null,
      })),
    })),
  };
}

function toRideResponse(ride: RideView) {
  return {
    ref: ride.ref,
    mode: ride.mode,
    status: ride.status,
    city: { id: ride.city.id, name: ride.city.data.name },
    route: ride.route.map(roundPoint),
    checkpoints: ride.checkpoints.map(toPlace),
    tier: ride.tier,
    fare: ride.fare,
    driver: ride.driver
      ? {
          name: ride.driver.name ?? null,
          vehicleNumber: ride.driver.vehicleNumber ?? null,
          vehicle: ride.driver.vehicle ?? null,
          otp: ride.driver.otp ?? null,
        }
      : null,
    position: ride.position ? roundPoint(ride.position) : null,
    area: ride.area ?? null,
    pickupSeconds: ride.pickupSeconds ?? null,
    guard: ride.guard ? { ...ride.guard, progress: round(ride.guard.progress, 3) } : null,
    shareUrl: ride.shareUrl ?? null,
    reassigning: ride.reassigning,
    cancelledByRider: ride.cancelledByRider,
    stale: ride.stale,
    canCancel: ride.canCancel,
    cancelFee: ride.cancelFee,
    canDetour: ride.canDetour,
  };
}

/** Public like planning; a live ride is tied to the Namma Yatri session in the `x-ny-session` header. */
export const rideRoutes =
  ({ rides }: { rides?: RideBooking }): FastifyPluginAsync =>
  async (app) => {
    const requireRides = () => {
      if (!rides) throw new AppError(503, "NOT_CONFIGURED", "Ride booking is not configured");
      return rides;
    };

    app.post("/rides/link", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req) => {
      const { code } = linkBody.parse(req.body);
      return { session: await requireRides().link(code) };
    });

    app.get("/rides/link", async (req) => ({ linked: requireRides().isLinked(sessionOf(req)) }));

    app.delete("/rides/link", async (req, reply) => {
      requireRides().unlink(sessionOf(req));
      return reply.status(204).send();
    });

    app.post("/rides/quote", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
      const body = quoteBody.parse(req.body);
      return toQuoteResponse(await requireRides().quote({ ...body, session: sessionOf(req) }));
    });

    app.post("/rides", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
      const body = bookBody.parse(req.body);
      const ride = await requireRides().book({ ...body, session: sessionOf(req) });
      return reply.status(201).send(toRideResponse(ride));
    });

    app.get("/rides/:ref", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
      const { ref } = rideParams.parse(req.params);
      return toRideResponse(await requireRides().status(ref, sessionOf(req)));
    });

    app.post("/rides/:ref/cancel", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
      const { ref } = rideParams.parse(req.params);
      return toRideResponse(await requireRides().cancel(ref, sessionOf(req)));
    });

    app.post("/rides/:ref/detour", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
      const { ref } = rideParams.parse(req.params);
      return toRideResponse(requireRides().detour(ref));
    });
  };
