import { describe, expect, it, vi } from "vitest";
import { toSights } from "#scripts/ingest/osmSights.js";
import type { OverpassElement } from "#scripts/ingest/osmPois.js";
import { buildApp } from "#src/app.js";
import type { TokenVerifier } from "#src/auth/tokenVerifier.js";
import type { Poi, Sight } from "#src/city/cityData.js";
import { createCityRegistry } from "#src/city/cityRegistry.js";
import { createHoursEvaluator } from "#src/city/openingHours.js";
import { loadEnv } from "#src/config/env.js";
import type { LngLat } from "#src/geo/geometry.js";
import { AnthropicTextModel } from "#src/integrations/anthropic/client.js";
import { selectCandidates } from "#src/itinerary/candidates.js";
import { buildPrompt, parseReply } from "#src/itinerary/prompt.js";
import { scheduleTrip, tripStart } from "#src/itinerary/schedule.js";
import { slotsFor, type TripRequest } from "#src/itinerary/trip.js";
import { unauthorized } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import { createItineraryPlanner } from "#src/planner/itineraryPlanner.js";
import type { TextModel } from "#src/planner/ports.js";
import { NOON, testCity } from "#test/fixtures.js";

const BASE: LngLat = [73.82, 18.52];
const IST = 330;
const sight = (id: string, name: string, kind: Sight["kind"], lon: number, lat: number, extra: Partial<Sight> = {}): Sight => ({
  id,
  name,
  kind,
  lon,
  lat,
  ...extra,
});
const eatery = (id: string, name: string, cat: Poi["cat"], lon: number, lat: number): Poi => ({ id, name, cat, lon, lat });

const SIGHTS = [
  sight("s1", "Old Fort", "heritage", 73.83, 18.522, { famous: true }),
  sight("s2", "City Museum", "museum", 73.826, 18.527, { famous: true }),
  sight("s3", "Hill Temple", "worship", 73.812, 18.515, { famous: true }),
  sight("s4", "Lake Garden", "nature", 73.824, 18.512),
  sight("s5", "Flower Market", "market", 73.816, 18.525),
  sight("s6", "Corner Shrine", "worship", 73.821, 18.519),
];
const EATERIES = [
  eatery("e1", "Morning Cafe", "cafe", 73.821, 18.521),
  eatery("e2", "Annapurna Pure Veg", "restaurant", 73.828, 18.523),
  eatery("e3", "Kebab Corner", "restaurant", 73.829, 18.524),
  eatery("e4", "Chai Stop", "cafe", 73.825, 18.526),
  eatery("e5", "Spice Kitchen", "restaurant", 73.818, 18.518),
  eatery("e6", "Dosa House", "restaurant", 73.822, 18.517),
  eatery("e7", "Starbucks", "cafe", 73.8205, 18.5205),
  eatery("e8", "Ishaan Pure Veg", "restaurant", 73.815, 18.52),
  eatery("e9", "Ishan Pure VEG", "restaurant", 73.8151, 18.5201),
  eatery("e10", "Night Bites", "fast_food", 73.823, 18.521),
  eatery("e11", "Egg Factory", "cafe", 73.819, 18.522),
];

const tripCity = (sights: Sight[] = SIGHTS) => testCity({ sights, pois: EATERIES });
const trip = (overrides: Partial<TripRequest> = {}): TripRequest => ({
  base: { name: "Deccan, Pune", point: BASE },
  days: 1,
  interests: ["food", "heritage"],
  diet: "any",
  backBy: "sunset",
  ...overrides,
});
const names = (list: readonly { name: string }[]) => list.map((c) => c.name);
const minuteOfDayIst = (iso: string | Date) => {
  const local = new Date(new Date(iso).getTime() + IST * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

const refOf = (prompt: string, name: string) => new RegExp(`^(\\d+) ${name}\\|`, "m").exec(prompt)?.[1] ?? "0";
const aiReply = (prompt: string) =>
  [
    "Here is your plan:",
    "T Forts, thalis and chai",
    `1 B ${refOf(prompt, "Morning Cafe")} Filter coffee and idli`,
    `1 M ${refOf(prompt, "Old Fort")} Walk the ramparts early`,
    `1 L ${refOf(prompt, "Annapurna Pure Veg")} Maharashtrian thali`,
    `1 A ${refOf(prompt, "City Museum")} Miniature paintings gallery`,
    `1 S ${refOf(prompt, "Chai Stop")} Cutting chai`,
  ].join("\n");

const fakeModel = (complete: TextModel["complete"] = async ({ prompt }) => ({ text: aiReply(prompt), costUsd: 0.0006 })) => ({
  complete: vi.fn(complete),
});

describe("trip candidates", () => {
  it("drops chains, meat places for veg riders and duplicate mappings of one place", () => {
    const veg = names(selectCandidates(tripCity(), trip({ diet: "veg" })));
    expect(veg).toContain("Annapurna Pure Veg");
    expect(veg).not.toContain("Kebab Corner");
    expect(veg).not.toContain("Egg Factory");
    expect(veg).not.toContain("Starbucks");
    expect(veg.filter((name) => /ishaa?n pure veg/i.test(name))).toHaveLength(1);

    const egg = names(selectCandidates(tripCity(), trip({ diet: "egg" })));
    expect(egg).toContain("Egg Factory");
    expect(egg).not.toContain("Kebab Corner");
  });

  it("ranks food near an offered sight above food equally far from the base near nothing", () => {
    const city = testCity({
      sights: [sight("far", "Far Fort", "heritage", 73.87, 18.52, { famous: true })],
      pois: [eatery("near-sight", "Fort Canteen", "restaurant", 73.8702, 18.5201), eatery("nowhere", "Lonely Diner", "restaurant", 73.77, 18.52)],
    });
    const refs = new Map(selectCandidates(city, trip()).map((c) => [c.name, c.ref]));
    expect(refs.get("Fort Canteen")!).toBeLessThan(refs.get("Lonely Diner")!);
  });

  it("offers unlinked places of worship only to riders who asked for temples", () => {
    expect(names(selectCandidates(tripCity(), trip()))).not.toContain("Corner Shrine");
    expect(names(selectCandidates(tripCity(), trip({ interests: ["temples"] })))).toContain("Corner Shrine");
  });
});

describe("trip reply parsing", () => {
  const t = trip();
  const candidates = selectCandidates(tripCity(), t);
  const ref = (name: string) => candidates.find((c) => c.name === name)!.ref;

  it("keeps valid lines and drops everything the model was not allowed to say", () => {
    const reply = [
      "Sure! Here is a plan.",
      "T Old city in a day",
      `- 1 B ${ref("Morning Cafe")} Idli and coffee`,
      `1 B ${ref("Dosa House")} second breakfast`,
      `1 M ${ref("Old Fort")} Early walk`,
      `1 M ${ref("Annapurna Pure Veg")} eatery as a sight`,
      `1 L ${ref("City Museum")} sight as a meal`,
      `1 L ${ref("Morning Cafe")} same place twice`,
      `1 L 999 invented place`,
      `2 L ${ref("Spice Kitchen")} day out of range`,
      `1 D ${ref("Dosa House")} dinner not offered`,
      `1 X ${ref("Dosa House")} unknown slot`,
      `1 L ${ref("Annapurna Pure Veg")} **Thali** lunch`,
    ].join("\n");
    const parsed = parseReply(reply, candidates, 1, slotsFor(t));
    expect(parsed.title).toBe("Old city in a day");
    expect(parsed.picks.map((p) => [p.slot, p.candidate.name, p.note])).toEqual([
      ["breakfast", "Morning Cafe", "Idli and coffee"],
      ["morning", "Old Fort", "Early walk"],
      ["lunch", "Annapurna Pure Veg", "Thali lunch"],
    ]);
  });

  it("budgets output tokens by trip length and sends one short line per place", () => {
    const prompt = buildPrompt(t, slotsFor(t), candidates);
    expect(prompt.maxTokens).toBe(140);
    expect(buildPrompt(trip({ days: 3 }), slotsFor(t), candidates).maxTokens).toBe(340);
    expect(prompt.prompt).toMatch(/^\d+ Old Fort\|[^|]*\|heritage,famous$/m);
    expect(prompt.prompt).toContain("Slots each day: B M L A S.");
  });
});

describe("trip scheduling", () => {
  const planner = (sights?: Sight[]) => createItineraryPlanner({ cities: createCityRegistry([tripCity(sights)]), now: () => NOON });

  it("starts tomorrow morning in city time when asked after the morning has begun", () => {
    expect(tripStart(NOON, IST).toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(tripStart(new Date("2026-11-14T01:00:00Z"), IST).toISOString()).toBe("2026-11-14T03:00:00.000Z");
  });

  it("brings a 'before dark' rider home by dusk with no dark legs", async () => {
    const [day] = (await planner().plan(trip())).days;
    expect(day!.stops.length).toBeGreaterThanOrEqual(5);
    expect(day!.stops.map((s) => s.slot)).not.toContain("dinner");
    expect(day!.legs).toHaveLength(day!.stops.length + 1);
    expect(day!.legs.at(-1)!.arriveAt.getTime()).toBeLessThanOrEqual(day!.dusk.getTime());
    expect(day!.legs.some((leg) => leg.dark)).toBe(false);
    const lunch = day!.stops.find((s) => s.slot === "lunch")!;
    expect(minuteOfDayIst(lunch.arriveAt)).toBeGreaterThanOrEqual(12 * 60);
  });

  it("adds dinner for a 22:00 rider and flags the ride home as dark", async () => {
    const [day] = (await planner().plan(trip({ backBy: "22:00" }))).days;
    const dinner = day!.stops.find((s) => s.slot === "dinner")!;
    expect(minuteOfDayIst(dinner.arriveAt)).toBeGreaterThanOrEqual(19 * 60 + 30);
    const home = day!.legs.at(-1)!;
    expect(home.dark).toBe(true);
    expect(minuteOfDayIst(home.arriveAt)).toBeLessThanOrEqual(22 * 60);
  });

  it("keeps a half day to the morning and spreads longer trips without repeating places", async () => {
    const half = await planner().plan(trip({ days: 0.5 }));
    expect(half.days[0]!.stops.map((s) => s.slot)).toEqual(expect.arrayContaining(["breakfast", "morning", "lunch"]));
    expect(half.days[0]!.stops.map((s) => s.slot)).not.toContain("afternoon");
    expect(minuteOfDayIst(half.days[0]!.legs.at(-1)!.arriveAt)).toBeLessThanOrEqual(14 * 60);

    const two = await planner().plan(trip({ days: 2 }));
    const ids = two.days.flatMap((d) => d.stops.map((s) => s.candidate.id));
    expect(two.days).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("swaps a sight that is listed as closed for an open one nearby, or drops it", () => {
    const run = (sights: Sight[]) => {
      const t = trip();
      const candidates = selectCandidates(tripCity(sights), t);
      const pick = (name: string, slot: "breakfast" | "morning") => ({ day: 0, slot, candidate: candidates.find((c) => c.name === name)! });
      return scheduleTrip([pick("Morning Cafe", "breakfast"), pick("City Museum", "morning")], {
        trip: t,
        startAt: tripStart(NOON, IST),
        days: 1,
        utcOffsetMinutes: IST,
        hours: createHoursEvaluator(BASE, IST),
        candidates,
      })[0]!;
    };
    const afternoonMuseum = sight("s2", "City Museum", "museum", 73.826, 18.527, { famous: true, hours: "Mo-Su 14:00-17:00" });

    expect(names(run([afternoonMuseum, SIGHTS[0]!]).stops.map((s) => s.candidate))).toEqual(["Morning Cafe", "Old Fort"]);
    expect(names(run([afternoonMuseum]).stops.map((s) => s.candidate))).toEqual(["Morning Cafe"]);
  });
});

describe("trip planning API", () => {
  const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const verifier: TokenVerifier = {
    verify: async () => {
      throw unauthorized();
    },
  };
  const payload = { base: { name: "Deccan, Pune", point: BASE }, days: 1, interests: ["food", "heritage"] };

  async function setup({ model, dailyBudgetUsd }: { model?: TextModel; dailyBudgetUsd?: number } = {}) {
    const cities = createCityRegistry([tripCity()]);
    const itineraries = createItineraryPlanner({
      cities,
      now: () => NOON,
      ...(model ? { model } : {}),
      ...(dailyBudgetUsd ? { dailyBudgetUsd } : {}),
    });
    return buildApp({ env, verifier, cities, itineraries });
  }

  it("plans a timed day from the model's picks, with its notes, for a guest", async () => {
    const model = fakeModel();
    const app = await setup({ model });
    const res = await app.inject({ method: "POST", url: "/api/itinerary", payload });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ title: "Forts, thalis and chai", source: "ai", fallback: null, city: { id: "testville", utcOffsetMinutes: IST } });
    const [day] = body.days;
    expect(day.stops.map((s: { slot: string; name: string }) => [s.slot, s.name])).toEqual([
      ["breakfast", "Morning Cafe"],
      ["morning", "Old Fort"],
      ["lunch", "Annapurna Pure Veg"],
      ["afternoon", "City Museum"],
      ["snack", "Chai Stop"],
    ]);
    expect(day.stops[0]).toMatchObject({ note: "Filter coffee and idli", arriveAt: expect.stringMatching(/Z$/) });
    expect(day.legs).toHaveLength(6);
    expect(model.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 140 }));
  });

  it("falls back to the basic plan without exposing why the model failed", async () => {
    const model = fakeModel(async () => {
      throw new UpstreamError("Trip assistant", 403);
    });
    const app = await setup({ model });
    const res = await app.inject({ method: "POST", url: "/api/itinerary", payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: "basic", fallback: "unavailable", title: "A day around Deccan" });
    expect(res.json().days[0].stops.length).toBeGreaterThanOrEqual(5);
    expect(res.body).not.toContain("403");
  });

  it("asks the model once for a repeated trip and stops asking once today's budget is spent", async () => {
    const model = fakeModel(async ({ prompt }) => ({ text: aiReply(prompt), costUsd: 0.002 }));
    const app = await setup({ model, dailyBudgetUsd: 0.001 });
    const first = await app.inject({ method: "POST", url: "/api/itinerary", payload });
    const repeat = await app.inject({ method: "POST", url: "/api/itinerary", payload });
    const other = await app.inject({ method: "POST", url: "/api/itinerary", payload: { ...payload, diet: "veg" } });
    expect(first.json().source).toBe("ai");
    expect(repeat.json().source).toBe("ai");
    expect(other.json()).toMatchObject({ source: "basic", fallback: "daily_limit" });
    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("uses the basic planner when no model is configured", async () => {
    const app = await setup();
    const res = await app.inject({ method: "POST", url: "/api/itinerary", payload });
    expect(res.json()).toMatchObject({ source: "basic", fallback: "not_configured" });
  });

  it("rejects invalid answers and starting points outside covered cities", async () => {
    const app = await setup();
    const post = (body: unknown) => app.inject({ method: "POST", url: "/api/itinerary", payload: body as object });
    expect((await post({ ...payload, days: 5 })).statusCode).toBe(400);
    expect((await post({ ...payload, interests: ["food", "heritage", "temples", "nature"] })).statusCode).toBe(400);
    expect((await post({ ...payload, extra: true })).statusCode).toBe(400);
    expect((await post({ ...payload, base: { name: "\n", point: BASE } })).statusCode).toBe(400);
    const outside = await post({ ...payload, base: { name: "Mumbai", point: [72.88, 19.07] } });
    expect(outside.statusCode).toBe(422);
    expect(outside.json().error.code).toBe("OUTSIDE_COVERAGE");
  });
});

describe("Anthropic client", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("asks Haiku with no sampling parameters and prices the reply from its usage", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ content: [{ type: "text", text: "T Trip\n1 B 3 Idli" }], usage: { input_tokens: 1000, output_tokens: 100 } }),
    );
    const reply = await new AnthropicTextModel("test-key", fetchImpl).complete({ system: "rules", prompt: "places", maxTokens: 140 });

    expect(reply.text).toBe("T Trip\n1 B 3 Idli");
    expect(reply.costUsd).toBeCloseTo(0.00015, 10);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2026-10-21" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 140,
      system: "rules",
      messages: [{ role: "user", content: "places" }],
    });
  });

  it("reports a refusal as an upstream error that never carries the key", async () => {
    const fetchImpl = vi.fn(async () => json({ type: "error", error: { type: "permission_error", message: "test-key denied" } }, 403));
    const error = await new AnthropicTextModel("test-key", fetchImpl).complete({ system: "s", prompt: "p", maxTokens: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 403 });
    expect(String(error)).not.toContain("test-key");
  });
});

describe("OSM sight ingest", () => {
  const element = (id: number, tags: Record<string, string>, lon: number, lat = 18.52): OverpassElement => ({
    type: "way",
    id,
    center: { lon, lat },
    tags,
  });

  it("keeps famous and clearly visitable places, once each", () => {
    const sights = toSights([
      element(1, { tourism: "attraction", name: "Aga Khan Palace" }, 73.9),
      element(2, { historic: "palace", name: "Aga Khan Palace", wikidata: "Q1" }, 73.9005),
      element(3, { historic: "memorial", name: "Small Plaque" }, 73.86),
      element(4, { leisure: "park", name: "Lane 5 Park" }, 73.87),
      element(5, { leisure: "park", name: "Saras Baug" }, 73.85),
      element(6, { amenity: "place_of_worship", name: "Corner Mandir" }, 73.84),
      element(7, { tourism: "museum", name: "Kelkar Museum", opening_hours: "Mo-Su 10:00-17:00" }, 73.855),
    ]);
    expect(sights.map((s) => [s.name, s.kind, Boolean(s.famous)])).toEqual([
      ["Aga Khan Palace", "heritage", true],
      ["Kelkar Museum", "museum", false],
      ["Corner Mandir", "worship", false],
      ["Saras Baug", "nature", false],
    ]);
    expect(sights.find((s) => s.name === "Kelkar Museum")?.hours).toBe("Mo-Su 10:00-17:00");
  });
});
