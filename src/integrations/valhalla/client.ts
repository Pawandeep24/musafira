/**
 * Routing via Valhalla: two-wheeler candidates (`motor_scooter`) and car routes (`auto`) for
 * ride-hailing handoff.
 *
 * Each search makes 1 `/route` call (primary + up to 2 alternates) and 1
 * `/trace_attributes` call per route for road classes. Valhalla's maneuvers give
 * travel time per stretch of shape; we spread each maneuver's time over its
 * vertices by distance to get an ETA at every vertex.
 *
 * Car routes through checkpoints mark the middle points `via` (pass through, U-turn allowed),
 * which keeps one leg. Routes drawn by someone else (a ride app's route) get road classes by
 * `map_snap` matching, thinned to MATCH_SPACING_METERS / MAX_MATCH_POINTS to keep requests small.
 *
 * The public server (valhalla1.openstreetmap.de) is fair-use only; point
 * VALHALLA_URL at a self-hosted instance for anything beyond demos.
 */
import { z } from "zod";
import { haversineMeters, type LngLat } from "../../geo/geometry.js";
import { measurePath } from "../../geo/path.js";
import { decodePolyline } from "../../geo/polyline.js";
import { AppError } from "../../lib/errors.js";
import { fetchJson, UpstreamError } from "../../lib/http.js";
import type { CarRouter, RouteProvider } from "../../planner/ports.js";
import type { CandidateRoute, RoadSpan } from "../../safety/types.js";

const SERVICE = "Routing service";
const MATCH_SPACING_METERS = 20;
const MAX_MATCH_POINTS = 400;
const TRACE_FILTERS = { attributes: ["edge.length", "edge.road_class", "edge.use", "edge.tunnel"], action: "include" };

const maneuverSchema = z.object({
  time: z.number(),
  begin_shape_index: z.number().int(),
  end_shape_index: z.number().int(),
});
const tripSchema = z.object({
  summary: z.object({ length: z.number(), time: z.number() }),
  legs: z.array(z.object({ shape: z.string(), maneuvers: z.array(maneuverSchema) })).min(1),
});
const routeResponse = z.object({ trip: tripSchema, alternates: z.array(z.object({ trip: tripSchema })).optional() });
const traceResponse = z.object({
  edges: z.array(
    z.object({
      length: z.number(),
      road_class: z.string().optional(),
      use: z.string().optional(),
      tunnel: z.boolean().optional(),
    }),
  ),
});

type Trip = z.infer<typeof tripSchema>;

/** Uses that sit on ordinary roads; for these the road class is the meaningful label. */
const ROAD_USES = new Set(["road", "ramp", "turn_channel", undefined]);

function vertexSeconds(shape: readonly LngLat[], maneuvers: Trip["legs"][number]["maneuvers"]): number[] {
  const seconds = new Array<number>(shape.length).fill(0);
  let elapsed = 0;
  for (const maneuver of maneuvers) {
    const begin = maneuver.begin_shape_index;
    const end = Math.min(maneuver.end_shape_index, shape.length - 1);
    let length = 0;
    for (let i = begin; i < end; i++) length += haversineMeters(shape[i]!, shape[i + 1]!);
    let covered = 0;
    for (let i = begin; i < end; i++) {
      covered += haversineMeters(shape[i]!, shape[i + 1]!);
      const share = length > 0 ? covered / length : (i - begin + 1) / (end - begin);
      seconds[i + 1] = elapsed + maneuver.time * share;
    }
    elapsed += maneuver.time;
  }
  return seconds;
}

function roadSpans(edges: z.infer<typeof traceResponse>["edges"], routeMeters: number): RoadSpan[] {
  const totalKm = edges.reduce((sum, e) => sum + e.length, 0);
  if (totalKm <= 0) return [];
  let cumulativeKm = 0;
  return edges.map((edge) => {
    cumulativeKm += edge.length;
    return {
      endMeters: (cumulativeKm / totalKm) * routeMeters,
      roadClass: ROAD_USES.has(edge.use) ? (edge.road_class ?? "unclassified") : edge.use!,
      tunnel: edge.tunnel ?? false,
    };
  });
}

function thin(shape: readonly LngLat[], totalMeters: number): LngLat[] {
  const spacing = Math.max(MATCH_SPACING_METERS, totalMeters / MAX_MATCH_POINTS);
  const kept: LngLat[] = [shape[0]!];
  for (const point of shape.slice(1, -1)) {
    if (haversineMeters(kept.at(-1)!, point) >= spacing) kept.push(point);
  }
  if (shape.length > 1) kept.push(shape.at(-1)!);
  return kept;
}

const noRoute = (message: string) => (error: unknown) => {
  if (error instanceof UpstreamError && error.status === 400) throw new AppError(422, "NO_ROUTE", message);
  throw error;
};

export interface ValhallaOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class ValhallaClient implements RouteProvider, CarRouter {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor({ baseUrl, fetchImpl = fetch, timeoutMs = 15_000 }: ValhallaOptions) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async routes(from: LngLat, to: LngLat): Promise<CandidateRoute[]> {
    const response = await this.#post("/route", routeResponse, {
      locations: [
        { lon: from[0], lat: from[1] },
        { lon: to[0], lat: to[1] },
      ],
      costing: "motor_scooter",
      alternates: 2,
      directions_type: "maneuvers",
      units: "kilometers",
    }).catch(noRoute("No two-wheeler route found between these points"));

    const trips = [response.trip, ...(response.alternates ?? []).map((a) => a.trip)];
    return Promise.all(trips.map((trip) => this.#toCandidate(trip)));
  }

  async through(points: readonly LngLat[]): Promise<CandidateRoute> {
    const last = points.length - 1;
    const { trip } = await this.#post("/route", routeResponse, {
      locations: points.map(([lon, lat], i) => ({ lon, lat, type: i === 0 || i === last ? "break" : "via" })),
      costing: "auto",
      directions_type: "maneuvers",
      units: "kilometers",
    }).catch(noRoute("No car route found for this trip"));
    const leg = trip.legs[0]!;
    const shape = decodePolyline(leg.shape, 6);
    return {
      shape,
      secondsAt: vertexSeconds(shape, leg.maneuvers),
      distanceMeters: trip.summary.length * 1000,
      durationSeconds: trip.summary.time,
      roads: [],
    };
  }

  async roadsAlong(shape: readonly LngLat[]): Promise<RoadSpan[]> {
    if (shape.length < 2) return [];
    const { totalMeters } = measurePath(shape);
    return this.#post("/trace_attributes", traceResponse, {
      shape: thin(shape, totalMeters).map(([lon, lat]) => ({ lon, lat })),
      shape_match: "map_snap",
      costing: "auto",
      filters: TRACE_FILTERS,
    })
      .then((trace) => roadSpans(trace.edges, totalMeters))
      .catch(() => []);
  }

  async #toCandidate(trip: Trip): Promise<CandidateRoute> {
    const leg = trip.legs[0]!;
    const shape = decodePolyline(leg.shape, 6);
    const distanceMeters = trip.summary.length * 1000;
    const roads = await this.#post("/trace_attributes", traceResponse, {
      encoded_polyline: leg.shape,
      shape_match: "edge_walk",
      costing: "motor_scooter",
      filters: TRACE_FILTERS,
    })
      .then((trace) => roadSpans(trace.edges, distanceMeters))
      .catch(() => []);

    return {
      shape,
      secondsAt: vertexSeconds(shape, leg.maneuvers),
      distanceMeters,
      durationSeconds: trip.summary.time,
      roads,
    };
  }

  #post<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    return fetchJson(this.#fetch, SERVICE, `${this.#baseUrl}${path}`, schema, {
      method: "POST",
      body,
      timeoutMs: this.#timeoutMs,
    });
  }
}
