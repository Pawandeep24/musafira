import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import type { LngLat } from "#src/geo/geometry.js";
import { AppError, badRequest } from "#src/lib/errors.js";
import type { PlaceSuggester } from "#src/planner/placeSuggester.js";
import type { Geocoder } from "#src/planner/ports.js";

interface Deps {
  cities: CityRegistry;
  suggester: PlaceSuggester;
  geocoder?: Geocoder;
}

const lon = z.coerce.number().min(-180).max(180);
const lat = z.coerce.number().min(-90).max(90);
const suggestQuery = z.object({
  q: z.string().trim().min(2).max(100),
  city: z.string().max(40),
  lon: lon.optional(),
  lat: lat.optional(),
});
const reverseQuery = z.object({ lon, lat });
const suggestRateLimit = { max: 300, timeWindow: "1 minute" };
const reverseRateLimit = { max: 60, timeWindow: "1 minute" };

export const placesRoutes =
  ({ cities, suggester, geocoder }: Deps): FastifyPluginAsync =>
  async (app) => {
    app.get("/places/suggest", { config: { rateLimit: suggestRateLimit } }, async (req) => {
      const query = suggestQuery.parse(req.query);
      const city = cities.cities.find((c) => c.id === query.city);
      if (!city) throw badRequest("Unknown city");
      const near: LngLat | undefined = query.lon !== undefined && query.lat !== undefined ? [query.lon, query.lat] : undefined;
      return { places: await suggester.suggest(city, query.q, near && city.contains(near) ? near : undefined) };
    });

    app.get("/places/reverse", { config: { rateLimit: reverseRateLimit } }, async (req) => {
      if (!geocoder) throw new AppError(503, "NOT_CONFIGURED", "Place search is not configured");
      const { lon, lat } = reverseQuery.parse(req.query);
      return { place: (await geocoder.reverse([lon, lat])) ?? null };
    });
  };
