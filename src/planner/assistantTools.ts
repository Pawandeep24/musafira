/**
 * The city assistant's tools: what Claude may look up, answered from Musafira's own data for one city.
 *
 * Contract with the model:
 *   - inputs are zod schemas, sent to Claude as JSON Schema and checked again here;
 *   - times in and out are city time "YYYY-MM-DDTHH:mm" (left out = now), dates "YYYY-MM-DD";
 *   - every place in a result gets a ref (p1, p2…) for this question; a tool that takes a place accepts
 *     a ref or a name, and a name goes through the city's place search;
 *   - "me" is the rider's location when they shared it and it is inside the city; Claude never sees
 *     its coordinates, only distances from it;
 *   - results are compact JSON; opening times carry `typical: true` when they are category defaults;
 *   - problems a question can cause (unknown place, outside coverage, time out of range, a service
 *     down) come back as tool errors for Claude to explain; anything else fails the request.
 *
 * Routes use the same planner, window (an hour ago to 14 days ahead) and presets as /plan; the last
 * one planned is offered to the app as "Show this route", and its routes are what find_along_route
 * searches for errands on the way.
 */
import { getTimes } from "suncalc";
import { z } from "zod";
import { openAlongRoute } from "#src/assistant/alongRoute.js";
import { checkArea, openPlacesNear, type OpenPlace } from "#src/assistant/area.js";
import { CITY_TIME, fromCityTime, toCityTime } from "#src/assistant/cityTime.js";
import { POI_CATEGORIES, SIGHT_KINDS, type Poi, type PoiCategory } from "#src/city/cityData.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { HoursEvaluator, OpenState } from "#src/city/openingHours.js";
import { haversineMeters, type LngLat } from "#src/geo/geometry.js";
import { AppError } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import type { PlaceSuggester } from "#src/planner/placeSuggester.js";
import type { ReportSource, ToolCall, ToolOutcome, ToolSpec } from "#src/planner/ports.js";
import type { RoutePlanner } from "#src/planner/routePlanner.js";
import type { SafeStops } from "#src/planner/safeStops.js";
import { bandOf, type CommunityReport } from "#src/safety/community.js";
import { DEFAULT_OPTIONS, PRESETS } from "#src/safety/parameters.js";
import type { Segment, Stretch } from "#src/safety/types.js";

const MAX_PLACES = 6;
const MAX_SIGHTS = 8;
const MAX_ROUTES = 3;
const SIGHTS_NEAR_METERS = 15_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ROUTE_PAST_MS = HOUR_MS;
const ROUTE_AHEAD_MS = 14 * DAY_MS;

const CATEGORY: Readonly<Record<PoiCategory, readonly [one: string, many: string]>> = {
  police: ["Police station", "police stations"],
  hospital: ["Hospital", "hospitals"],
  clinic: ["Clinic", "clinics"],
  doctors: ["Doctor", "doctors"],
  pharmacy: ["Pharmacy", "pharmacies"],
  fuel: ["Fuel station", "fuel stations"],
  hotel: ["Hotel", "hotels"],
  convenience: ["Convenience store", "convenience stores"],
  supermarket: ["Supermarket", "supermarkets"],
  shop: ["Shop", "shops"],
  restaurant: ["Restaurant", "restaurants"],
  cafe: ["Café", "cafés"],
  fast_food: ["Fast food", "fast-food places"],
  bike_repair: ["Bike repair", "bike repair shops"],
  bus_stop: ["Bus stop", "bus stops"],
  transit_station: ["Station", "stations"],
  safe_stop: ["Safe Stop", "Safe Stops"],
};
const WASHROOM_NAMES = { safeStop: "Safe Stop washroom", public: "Public toilet", fuel: "Fuel station toilet" } as const;
export const RIDER_REF = "me";

export interface NamedPlace {
  readonly name: string;
  readonly point: LngLat;
}

export interface RouteIdea {
  readonly from: NamedPlace;
  readonly to: NamedPlace;
  readonly departAt: Date;
}

export interface AssistantToolDeps {
  readonly planner: Pick<RoutePlanner, "plan">;
  readonly suggester: PlaceSuggester;
  readonly reports: ReportSource;
  readonly safeStops: Pick<SafeStops, "listed" | "washroomsNear">;
  readonly now: () => Date;
}

export interface ToolSession {
  readonly specs: readonly ToolSpec[];
  readonly places: ReadonlyMap<string, NamedPlace>;
  label(call: ToolCall): string;
  run(call: ToolCall): Promise<ToolOutcome>;
  route(): RouteIdea | undefined;
}

interface Tool {
  readonly spec: ToolSpec;
  label(input: unknown): string;
  run(input: unknown): Promise<unknown>;
}

function defineTool<S extends z.ZodType>(
  name: string,
  description: string,
  input: S,
  label: (input: z.output<S>) => string,
  run: (input: z.output<S>) => unknown,
): Tool {
  const inputSchema: Record<string, unknown> = { ...z.toJSONSchema(input, { io: "input" }) };
  delete inputSchema.$schema;
  return {
    spec: { name, description, inputSchema },
    label: (raw) => {
      const parsed = input.safeParse(raw);
      return parsed.success ? label(parsed.data) : "Looking that up";
    },
    run: async (raw) => run(input.parse(raw)),
  };
}

const placeInput = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("A place ref from an earlier result (p3), me for the rider's shared location, or a place name in the city");
const timeInput = z.string().regex(CITY_TIME).optional().describe("City time YYYY-MM-DDTHH:mm; leave out for right now");
const lengthOf = (stretches: readonly Stretch[]) => Math.round(stretches.reduce((sum, s) => sum + s.endMeters - s.startMeters, 0));
const roundMeters = (meters: number) => Math.round(meters / 10) * 10;

export function createToolSession(deps: AssistantToolDeps, city: CityIndex, hours: HoursEvaluator, rider?: LngLat): ToolSession {
  const offset = city.data.utcOffsetMinutes;
  const places = new Map<string, NamedPlace>(rider ? [[RIDER_REF, { name: "Your location", point: rider }]] : []);
  const refByPlace = new Map<string, string>();
  let issued = 0;
  let lastRoute: RouteIdea | undefined;
  let lastRouteSegments: (readonly Segment[])[] = [];

  const clock = (at: Date) => toCityTime(at, offset).slice(11);
  const timeAt = (text: string | undefined) => {
    if (text === undefined) return deps.now();
    const at = fromCityTime(text, offset);
    if (!at) throw new AppError(400, "BAD_TIME", `${text} is not a valid city time`);
    return at;
  };
  const openUntil = (state: Pick<OpenState, "estimated" | "closesAt">) => ({
    until: state.closesAt ? clock(state.closesAt) : "24h",
    ...(state.estimated ? { typical: true } : {}),
  });

  const remember = (name: string, point: LngLat) => {
    const key = `${name}|${point[0].toFixed(5)},${point[1].toFixed(5)}`;
    const known = refByPlace.get(key);
    if (known) return known;
    const ref = `p${++issued}`;
    places.set(ref, { name, point });
    refByPlace.set(key, ref);
    return ref;
  };
  const poiRef = (poi: Poi) => remember(poi.name ?? CATEGORY[poi.cat][0], [poi.lon, poi.lat]);

  const nameOf = (text: string) => (text.toLowerCase() === RIDER_REF ? "your location" : (places.get(text.toLowerCase())?.name ?? text));
  const resolve = async (text: string) => {
    if (text.toLowerCase() === RIDER_REF) {
      const here = places.get(RIDER_REF);
      if (!here) throw new AppError(400, "NO_LOCATION", "The rider hasn't shared their location; ask them to tap the location button or name a place");
      return { ref: RIDER_REF, ...here };
    }
    if (/^p\d+$/i.test(text)) {
      const ref = text.toLowerCase();
      const place = places.get(ref);
      if (!place) throw new AppError(404, "UNKNOWN_PLACE", `${text} is not a place ref from this question; search for the place by name`);
      return { ref, ...place };
    }
    const [found] = await deps.suggester.suggest(city, text);
    if (!found || !city.contains(found.point)) throw new AppError(404, "UNKNOWN_PLACE", `No place called "${text}" found in ${city.data.name}`);
    return { ref: remember(found.name, found.point), name: found.name, point: found.point };
  };
  const areaInput = (point: LngLat, at: Date) => ({ city, hours, safeStops: deps.safeStops.listed(city.id), point, at });
  const openPlace = ({ poi, meters, ...state }: OpenPlace) => ({
    ref: poiRef(poi),
    category: poi.cat,
    meters: roundMeters(meters),
    ...openUntil(state),
  });
  const groupReports = (reports: readonly CommunityReport[]) => {
    const counts = new Map<string, number>();
    for (const r of reports) {
      const key = `${r.category}|${bandOf(r.observedAt, offset)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => {
        const [category, timeOfDay] = key.split("|");
        return { category, timeOfDay, count };
      });
  };

  const tools: readonly Tool[] = [
    defineTool(
      "find_place",
      "Search the city's places by name: areas, streets, landmarks, colleges, malls, hospitals. Returns up to 5 matches with refs.",
      z.object({ query: z.string().trim().min(1).max(120) }),
      ({ query }) => `Looking up ${query}`,
      async ({ query }) => {
        const found = await deps.suggester.suggest(city, query);
        return {
          places: found
            .filter((p) => city.contains(p.point))
            .slice(0, 5)
            .map((p) => ({ ref: remember(p.name, p.point), name: p.name, label: p.label, ...(p.kind ? { kind: p.kind } : {}) })),
        };
      },
    ),
    defineTool(
      "check_area",
      "What a spot is like at a time: light after dusk (from night-time satellite imagery), mobile signal, how many places are open around it (people about), help points open within 1 km, and rider reports within 500 m from the last 90 days.",
      z.object({ place: placeInput, time: timeInput }),
      ({ place, time }) => `Checking ${nameOf(place)} ${time ? `at ${time.slice(11)}` : "now"}`,
      async ({ place, time }) => {
        const at = timeAt(time);
        const target = await resolve(place);
        const area = checkArea({ ...areaInput(target.point, at), reports: deps.reports.active(city.id) });
        return {
          place: target.ref,
          time: toCityTime(at, offset),
          light: area.light,
          signal: area.signal,
          peopleAround: area.people,
          openPlacesWithin300m: area.openPlaces,
          helpWithin1km: area.help.map(openPlace),
          riderReports: area.reports.map((r) => ({ category: r.category, timeOfDay: r.band, count: r.count, lastDaysAgo: r.lastDaysAgo })),
        };
      },
    ),
    defineTool(
      "find_open_places",
      "Places of one category open at a time near a place, nearest first. Opening times are OSM hours where tagged, typical hours otherwise.",
      z.object({
        category: z.enum(POI_CATEGORIES),
        place: placeInput,
        time: timeInput,
        radius_m: z.number().int().min(200).max(5000).default(1500),
      }),
      ({ category, place }) => `Finding open ${CATEGORY[category][1]} near ${nameOf(place)}`,
      async ({ category, place, time, radius_m }) => {
        const at = timeAt(time);
        const target = await resolve(place);
        const open = openPlacesNear(areaInput(target.point, at), radius_m).filter((p) => p.poi.cat === category);
        return { near: target.ref, time: toCityTime(at, offset), openCount: open.length, places: open.slice(0, MAX_PLACES).map(openPlace) };
      },
    ),
    defineTool(
      "find_washrooms",
      "Washrooms open at a time within 4 km of a place, best first: listed Safe Stops, public toilets and fuel stations, with what is known (women's section, free, pads, attendant, lock inside).",
      z.object({ place: placeInput, time: timeInput }),
      ({ place }) => `Finding washrooms near ${nameOf(place)}`,
      async ({ place, time }) => {
        const at = timeAt(time);
        const target = await resolve(place);
        const { washrooms } = deps.safeStops.washroomsNear(target.point, at);
        return {
          near: target.ref,
          time: toCityTime(at, offset),
          washrooms: washrooms.slice(0, 5).map((w) => ({
            ref: remember(w.name ?? WASHROOM_NAMES[w.source], w.point),
            kind: w.source,
            meters: roundMeters(w.distanceMeters),
            rideMinutes: w.rideMinutes,
            ...openUntil(w),
            ...w.facts,
          })),
        };
      },
    ),
    defineTool(
      "plan_route",
      "Score two-wheeler routes between two places for a departure time, as the Musafira app does. Score 0-100, higher is safer at that hour. Priorities: balanced; night-solo (light, help points and people first, for riding alone at night); connected (mobile signal first); low-fuel (fuel stations along the way). The app can show the last route planned.",
      z.object({
        from: placeInput,
        to: placeInput,
        depart_at: timeInput,
        priority: z.enum(PRESETS.map((p) => p.id) as [string, ...string[]]).default("balanced"),
      }),
      ({ from, to, depart_at }) => `Scoring routes from ${nameOf(from)} to ${nameOf(to)}${depart_at ? ` at ${depart_at.slice(11)}` : ""}`,
      async ({ from, to, depart_at, priority }) => {
        const departAt = timeAt(depart_at);
        const now = deps.now().getTime();
        if (departAt.getTime() < now - ROUTE_PAST_MS || departAt.getTime() > now + ROUTE_AHEAD_MS) {
          throw new AppError(400, "OUT_OF_RANGE", "Routes can be planned from an hour ago up to 14 days ahead");
        }
        const [a, b] = await Promise.all([resolve(from), resolve(to)]);
        const preset = PRESETS.find((p) => p.id === priority) ?? PRESETS[0]!;
        const plan = await deps.planner.plan({ from: a.point, to: b.point, departAt, weights: preset.weights, options: DEFAULT_OPTIONS });
        const routes = plan.routes.slice(0, MAX_ROUTES);
        lastRoute = { from: a, to: b, departAt: plan.departAt };
        lastRouteSegments = routes.map((r) => r.analysis.segments);
        return {
          from: a.ref,
          to: b.ref,
          departAt: toCityTime(plan.departAt, offset),
          priority: preset.id,
          routes: routes.map(({ labels, analysis, result }, i) => ({
            route: i + 1,
            labels,
            score: result.score,
            confidence: Math.round(result.confidence * 100) / 100,
            minutes: Math.round(analysis.durationSeconds / 60),
            km: Math.round(analysis.distanceMeters / 100) / 10,
            arriveAt: clock(analysis.arriveAt),
            darkMeters: lengthOf(result.darkStretches),
            noSignalMeters: lengthOf(result.deadZones),
            longestGapWithoutHelpMeters: roundMeters(result.longestStopGapMeters),
            reportedStretches: analysis.reportedStretches.length,
            ...(analysis.roadClosed ? { roadClosed: true } : {}),
          })),
        };
      },
    ),
    defineTool(
      "find_along_route",
      "Places of one category along a route from the last plan_route, open when the rider passes them, in riding order: within about 200 m of the road, with how far along and when. Use it for errands on the way (a pharmacy, fuel, a shop).",
      z.object({
        category: z.enum(POI_CATEGORIES),
        route: z.number().int().min(1).max(MAX_ROUTES).default(1).describe("Route number from plan_route; 1 is the first listed"),
      }),
      ({ category }) => `Finding open ${CATEGORY[category][1]} on the way`,
      ({ category, route }) => {
        const segments = lastRouteSegments[route - 1];
        if (!segments) {
          throw new AppError(400, "NO_ROUTE", lastRouteSegments.length ? `Only ${lastRouteSegments.length} routes were planned` : "Plan a route with plan_route first");
        }
        const open = openAlongRoute({ city, hours, safeStops: deps.safeStops.listed(city.id), segments, category });
        return {
          route,
          openCount: open.length,
          places: open.slice(0, MAX_PLACES).map(({ poi, alongMeters, offMeters, passAt, ...state }) => ({
            ref: poiRef(poi),
            category: poi.cat,
            kmAlong: Math.round(alongMeters / 100) / 10,
            offRouteMeters: roundMeters(offMeters),
            passAt: clock(passAt),
            ...openUntil(state),
          })),
        };
      },
    ),
    defineTool(
      "rider_reports",
      "Recent reports riders filed (poorly lit, well lit, deserted, busy, harassment, loitering, police nearby, bad road, waterlogged, no signal), with the time of day each was seen. Near a place, or across the city by area.",
      z.object({
        place: placeInput.optional(),
        radius_m: z.number().int().min(200).max(5000).default(1000),
        days: z.number().int().min(1).max(90).default(30),
      }),
      ({ place }) => (place ? `Reading rider reports near ${nameOf(place)}` : "Reading rider reports"),
      async ({ place, radius_m, days }) => {
        const since = deps.now().getTime() - days * DAY_MS;
        const recent = deps.reports.active(city.id).filter((r) => r.observedAt.getTime() >= since);
        if (place) {
          const target = await resolve(place);
          const near = recent.filter((r) => haversineMeters(target.point, r.point) <= radius_m);
          return { near: target.ref, radiusMeters: radius_m, days, total: near.length, reports: groupReports(near) };
        }
        const byArea = new Map<string, CommunityReport[]>();
        for (const r of recent) {
          const area = city.places.areaNear(r.point) ?? "Elsewhere";
          byArea.set(area, [...(byArea.get(area) ?? []), r]);
        }
        return {
          city: city.data.name,
          days,
          total: recent.length,
          reports: groupReports(recent),
          busiestAreas: [...byArea]
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 5)
            .map(([area, reports]) => ({ area, count: reports.length, reports: groupReports(reports) })),
        };
      },
    ),
    defineTool(
      "daylight",
      "Sunrise, sunset and civil dawn and dusk in the city for a date. After dusk the app treats streets as dark and scores lighting.",
      z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; leave out for today") }),
      () => "Checking sunset",
      ({ date }) => {
        const day = date ?? toCityTime(deps.now(), offset).slice(0, 10);
        const noon = timeAt(`${day}T12:00`);
        const { dawn, sunrise, sunset, dusk } = getTimes(noon, city.data.center[1], city.data.center[0]);
        const at = (time: Date | null) => (time ? clock(time) : null);
        return { date: day, dawn: at(dawn), sunrise: at(sunrise), sunset: at(sunset), dusk: at(dusk) };
      },
    ),
    defineTool(
      "find_sights",
      "Places to visit in the city (heritage, museums, places of worship, nature, markets, attractions) with whether they are open at a time. Famous ones first, or nearest first when a place is given.",
      z.object({ kind: z.enum(SIGHT_KINDS).optional(), near: placeInput.optional(), time: timeInput }),
      ({ near }) => (near ? `Finding places to visit near ${nameOf(near)}` : "Finding places to visit"),
      async ({ kind, near, time }) => {
        const at = timeAt(time);
        const target = near ? await resolve(near) : undefined;
        const sights = city.data.sights
          .filter((s) => !kind || s.kind === kind)
          .map((s) => ({ sight: s, meters: target ? haversineMeters(target.point, [s.lon, s.lat]) : 0 }))
          .filter(({ meters }) => meters <= SIGHTS_NEAR_METERS)
          .sort((a, b) => (target ? a.meters - b.meters : Number(b.sight.famous ?? false) - Number(a.sight.famous ?? false)))
          .slice(0, MAX_SIGHTS);
        return {
          ...(target ? { near: target.ref } : {}),
          time: toCityTime(at, offset),
          sights: sights.map(({ sight, meters }) => {
            const state = hours.stateAt({ cat: sight.kind, ...(sight.hours ? { hours: sight.hours } : {}) }, at);
            return {
              ref: remember(sight.name, [sight.lon, sight.lat]),
              kind: sight.kind,
              ...(sight.famous ? { famous: true } : {}),
              ...(target ? { meters: roundMeters(meters) } : {}),
              ...(state.open ? { open: true, ...openUntil(state) } : { open: false }),
            };
          }),
        };
      },
    ),
  ];
  const byName = new Map(tools.map((t) => [t.spec.name, t]));

  return {
    specs: tools.map((t) => t.spec),
    places,
    route: () => lastRoute,
    label: (call) => byName.get(call.name)?.label(call.input) ?? "Looking that up",
    async run(call) {
      const tool = byName.get(call.name);
      const fail = (content: string): ToolOutcome => ({ callId: call.id, content, isError: true });
      if (!tool) return fail(`Unknown tool ${call.name}`);
      try {
        return { callId: call.id, content: JSON.stringify(await tool.run(call.input)), isError: false };
      } catch (err) {
        if (err instanceof z.ZodError) return fail(`Invalid input: ${z.prettifyError(err)}`);
        if (err instanceof AppError) return fail(err.message);
        if (err instanceof UpstreamError) return fail(`${err.service} is unavailable right now`);
        throw err;
      }
    },
  };
}
