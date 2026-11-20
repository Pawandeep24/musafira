import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import { AppError } from "#src/lib/errors.js";
import type { RideBooking } from "#src/planner/rideBooking.js";
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, MAX_WEIGHT, PARAMETERS, PRESETS } from "#src/safety/parameters.js";

const cityParams = z.object({ cityId: z.string().max(40) });

/** Everything the client needs to render the planner: parameters, presets, covered cities, the contact address once mail can be sent, and whether the city assistant is on. */
export const configRoutes =
  (cities: CityRegistry, rides?: RideBooking, contactEmail?: string, assistant = false): FastifyPluginAsync =>
  async (app) => {
    app.get("/config", async () => ({
      ...(contactEmail ? { contactEmail } : {}),
      assistant,
      parameters: PARAMETERS,
      maxWeight: MAX_WEIGHT,
      presets: PRESETS,
      defaults: { weights: DEFAULT_WEIGHTS, options: DEFAULT_OPTIONS },
      cities: cities.cities.map(({ data }) => ({
        id: data.id,
        name: data.name,
        center: data.center,
        bbox: data.bbox,
        utcOffsetMinutes: data.utcOffsetMinutes,
        version: data.version,
        sources: data.sources,
        rides: rides?.support(data.id) ?? { live: false, demo: false },
      })),
    }));

    app.get("/cities/:cityId/layers", async (req, reply) => {
      const { cityId } = cityParams.parse(req.params);
      const city = cities.cities.find((c) => c.id === cityId);
      if (!city) throw new AppError(404, "NOT_FOUND", "Unknown city");
      reply.header("Cache-Control", "public, max-age=86400");
      return { lights: city.data.lights ?? null, cellDensity: city.data.cellDensity ?? null };
    });
  };
