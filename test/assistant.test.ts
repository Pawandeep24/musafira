import { describe, expect, it, vi } from "vitest";
import { buildApp } from "#src/app.js";
import type { TokenVerifier } from "#src/auth/tokenVerifier.js";
import { createCityRegistry } from "#src/city/cityRegistry.js";
import { createHoursEvaluator } from "#src/city/openingHours.js";
import type { Place } from "#src/city/placeSearch.js";
import { loadEnv } from "#src/config/env.js";
import type { LngLat } from "#src/geo/geometry.js";
import { AnthropicChatModel } from "#src/integrations/anthropic/chat.js";
import { unauthorized } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import { createToolSession } from "#src/planner/assistantTools.js";
import { createCityAssistant, type AssistantEvent } from "#src/planner/cityAssistant.js";
import type { PlaceSuggester } from "#src/planner/placeSuggester.js";
import type { ChatMessage, ChatRequest, ChatTurn, RouteProvider, ToolCall } from "#src/planner/ports.js";
import { createRoutePlanner } from "#src/planner/routePlanner.js";
import type { WashroomsNear } from "#src/planner/safeStops.js";
import type { CommunityReport } from "#src/safety/community.js";
import { grid, NIGHT, poi, ROUTE_EAST, ROUTE_LAT, ROUTE_WEST, straightRoute, testCity } from "#test/fixtures.js";

const WEST: LngLat = [ROUTE_WEST, ROUTE_LAT];
const EAST: LngLat = [ROUTE_EAST, ROUTE_LAT];
const DAY_MS = 86_400_000;

const city = testCity({
  lights: grid((lon) => (lon < 73.82 ? 40 : 1)),
  cellDensity: grid((lon) => (lon < 73.82 ? 50 : 2)),
  pois: [
    ...Array.from({ length: 12 }, (_, i) => poi(`food${i}`, ROUTE_WEST + i * 0.0002, "fast_food", "24/7")),
    poi("police1", ROUTE_WEST + 0.001, "police"),
    poi("shop1", ROUTE_EAST + 0.0003, "shop"),
    poi("chemist", ROUTE_EAST + 0.0005, "pharmacy"),
    poi("allnight", ROUTE_EAST + 0.001, "pharmacy", "24/7"),
  ],
});
const cities = createCityRegistry([city]);
const reports: CommunityReport[] = [{ id: "r1", category: "harassment", point: EAST, observedAt: new Date(NIGHT.getTime() - 2 * DAY_MS) }];

const PLACES: readonly Place[] = [
  { id: "a1", name: "Old Town", label: "Old Town, Testville", point: WEST, kind: "area" },
  { id: "a2", name: "River Gate", label: "River Gate, Testville", point: EAST, kind: "area" },
];
const suggester: PlaceSuggester = {
  suggest: async (_city, text) => PLACES.filter((p) => p.name.toLowerCase().includes(text.toLowerCase())),
};

function toolDeps(now = () => NIGHT) {
  const routing: RouteProvider = { routes: async () => [straightRoute()] };
  const washroomsNear = vi.fn(
    (point: LngLat, at: Date = now()): WashroomsNear => ({
      cityId: city.id,
      at,
      washrooms: [{ id: "w1", source: "fuel", point, facts: { women: true }, distanceMeters: 123, rideMinutes: 1, estimated: true, closesAt: new Date(at.getTime() + 3_600_000) }],
    }),
  );
  return {
    planner: createRoutePlanner({ cities, routing, now }),
    suggester,
    reports: { active: () => reports },
    safeStops: { listed: () => [], washroomsNear },
    now,
    washroomsNear,
  };
}

const session = (deps = toolDeps(), rider?: LngLat) => createToolSession(deps, city, createHoursEvaluator(city.data.center, city.data.utcOffsetMinutes), rider);
const call = (name: string, input: unknown, id = `call-${name}`): ToolCall => ({ id, name, input });
const runTool = async (s: ReturnType<typeof session>, name: string, input: unknown) => {
  const outcome = await s.run(call(name, input));
  return { ...outcome, json: outcome.isError ? undefined : JSON.parse(outcome.content) };
};

describe("assistant tools", () => {
  it("describes a lit, busy spot at night apart from a dark, deserted one with recent reports", async () => {
    const s = session();
    const west = (await runTool(s, "check_area", { place: "Old Town", time: "2026-11-14T23:00" })).json;
    const east = (await runTool(s, "check_area", { place: "River Gate", time: "2026-11-14T23:00" })).json;

    expect(west).toMatchObject({ place: "p1", time: "2026-11-14T23:00", light: "bright", signal: "strong", peopleAround: "busy", riderReports: [] });
    expect(west.helpWithin1km[0]).toMatchObject({ category: "police", until: "24h", typical: true });
    expect(east).toMatchObject({ light: "dark", signal: "none", peopleAround: "quiet" });
    expect(east.riderReports).toEqual([{ category: "harassment", timeOfDay: "night", count: 1, lastDaysAgo: 2 }]);
    expect(s.places.get("p1")).toEqual({ name: "Old Town", point: WEST });
  });

  it("calls daytime daylight, not dark, and gives sunset in city time", async () => {
    const s = session();
    expect((await runTool(s, "check_area", { place: "River Gate", time: "2026-11-14T12:00" })).json.light).toBe("daylight");
    const { json } = await runTool(s, "daylight", { date: "2026-11-14" });
    expect(json.sunset >= "17:30" && json.sunset <= "18:15").toBe(true);
    expect(json.dusk > json.sunset).toBe(true);
  });

  it("lists only places open at the asked time and flags typical hours", async () => {
    const s = session();
    const late = (await runTool(s, "find_open_places", { category: "pharmacy", place: "River Gate", time: "2026-11-14T23:30" })).json;
    const noon = (await runTool(s, "find_open_places", { category: "pharmacy", place: "River Gate", time: "2026-11-14T12:00" })).json;

    expect(late.openCount).toBe(1);
    expect(late.places[0]).toMatchObject({ category: "pharmacy", until: "24h" });
    expect(late.places[0].typical).toBeUndefined();
    expect(noon.openCount).toBe(2);
    expect(noon.places[0]).toMatchObject({ until: "22:30", typical: true });
  });

  it("asks for washrooms at the asked city time", async () => {
    const deps = toolDeps();
    const { json } = await runTool(session(deps), "find_washrooms", { place: "River Gate", time: "2026-11-15T00:00" });
    expect(deps.washroomsNear).toHaveBeenCalledWith(EAST, new Date("2026-11-14T18:30:00Z"));
    expect(json.washrooms[0]).toMatchObject({ ref: "p2", kind: "fuel", meters: 120, until: "01:00", typical: true, women: true });
  });

  it("scores routes at the asked time and offers the last one to the app", async () => {
    const s = session();
    const { json } = await runTool(s, "plan_route", { from: "Old Town", to: "River Gate", depart_at: "2026-11-14T23:00", priority: "night-solo" });

    expect(json).toMatchObject({ from: "p1", to: "p2", departAt: "2026-11-14T23:00", priority: "night-solo" });
    expect(json.routes[0]).toMatchObject({ score: expect.any(Number), km: expect.any(Number), darkMeters: expect.any(Number) });
    expect(s.route()).toEqual({ from: { ref: "p1", name: "Old Town", point: WEST }, to: { ref: "p2", name: "River Gate", point: EAST }, departAt: NIGHT });
  });

  it("finds places on the way that are open when the rider passes them, in riding order", async () => {
    const s = session();
    const names = (result: { places: { ref: string }[] }) => result.places.map((p) => s.places.get(p.ref)?.name);
    expect(await runTool(s, "find_along_route", { category: "pharmacy" })).toMatchObject({ isError: true, content: expect.stringContaining("plan_route") });

    await runTool(s, "plan_route", { from: "Old Town", to: "River Gate", depart_at: "2026-11-15T12:00" });
    const noon = (await runTool(s, "find_along_route", { category: "pharmacy" })).json;
    await runTool(s, "plan_route", { from: "Old Town", to: "River Gate", depart_at: "2026-11-14T23:00" });
    const night = (await runTool(s, "find_along_route", { category: "pharmacy" })).json;

    expect(names(noon)).toEqual(["pharmacy chemist", "pharmacy allnight"]);
    expect(noon.places[0]).toMatchObject({ kmAlong: expect.any(Number), passAt: expect.stringMatching(/^12:/), typical: true });
    expect(names(night)).toEqual(["pharmacy allnight"]);
    expect(night.places[0]).toMatchObject({ passAt: expect.stringMatching(/^23:/), until: "24h" });
    expect(await runTool(s, "find_along_route", { category: "pharmacy", route: 3 })).toMatchObject({ isError: true, content: expect.stringContaining("Only 1") });
  });

  it("treats a shared location as the place me, and says when the rider hasn't shared one", async () => {
    const s = session(toolDeps(), EAST);
    const { json } = await runTool(s, "find_open_places", { category: "pharmacy", place: "me", time: "2026-11-14T23:30" });
    expect(json).toMatchObject({ near: "me", openCount: 1 });
    expect(json.places[0].ref).toBe("p1");
    expect(s.places.get("me")).toEqual({ name: "Your location", point: EAST });
    expect(s.label(call("find_open_places", { category: "pharmacy", place: "me" }))).toBe("Finding open pharmacies near your location");

    expect(await runTool(session(), "check_area", { place: "me" })).toMatchObject({ isError: true, content: expect.stringContaining("location") });
  });

  it("returns problems a question can cause as tool errors Claude can explain", async () => {
    const s = session();
    const later = await runTool(s, "plan_route", { from: "Old Town", to: "River Gate", depart_at: "2026-12-14T23:00" });
    const unknownRef = await runTool(s, "check_area", { place: "p9" });
    const unknownName = await runTool(s, "check_area", { place: "Atlantis" });
    const badTime = await runTool(s, "check_area", { place: "Old Town", time: "2026-02-30T10:00" });
    const badInput = await runTool(s, "find_open_places", { category: "casino", place: "Old Town" });
    const unknownTool = await runTool(s, "book_taxi", {});

    expect(later).toMatchObject({ isError: true, content: expect.stringContaining("14 days") });
    expect(unknownRef).toMatchObject({ isError: true, content: expect.stringContaining("p9") });
    expect(unknownName).toMatchObject({ isError: true, content: expect.stringContaining("Atlantis") });
    expect([badTime, badInput, unknownTool].every((r) => r.isError)).toBe(true);
    expect(s.route()).toBeUndefined();
  });

  it("describes every tool to Claude as a JSON Schema object", () => {
    const specs = session().specs;
    expect(specs.map((t) => t.name)).toEqual(
      expect.arrayContaining(["find_place", "check_area", "find_open_places", "find_washrooms", "plan_route", "find_along_route", "rider_reports", "daylight", "find_sights"]),
    );
    for (const spec of specs) {
      expect(spec.inputSchema).toMatchObject({ type: "object" });
      expect(spec.inputSchema).not.toHaveProperty("$schema");
    }
    const route = specs.find((t) => t.name === "plan_route")!.inputSchema as { required?: string[] };
    expect(route.required).toEqual(["from", "to"]);
  });
});

const turn = (partial: Partial<ChatTurn>): ChatTurn => ({ text: "", calls: [], stop: "done", raw: [], costUsd: 0.01, ...partial });

function scriptedModel(...turns: ChatTurn[]) {
  const seen: ChatMessage[][] = [];
  const chat = vi.fn(async (request: ChatRequest): Promise<ChatTurn> => {
    seen.push([...request.messages]);
    return turns.shift() ?? turn({ text: "Out of script" });
  });
  return { chat, seen };
}

const collect = async (events: AsyncGenerator<AssistantEvent>) => {
  const out: AssistantEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const question = (text: string) => ({ cityId: city.id, messages: [{ role: "user" as const, text }] });

const nightCheck = () =>
  scriptedModel(
    turn({ stop: "tools", calls: [call("find_place", { query: "Old Town" }, "t1")] }),
    turn({ stop: "tools", calls: [call("check_area", { place: "p1", time: "2026-11-14T23:00" }, "t2")] }),
    turn({ text: "[[p1]] is **brightly lit** with places open. Avoid [[p7]] and [[Main Road]]." }),
  );

describe("city assistant", () => {
  const assistant = (model: ReturnType<typeof scriptedModel>, extra: { dailyBudgetUsd?: number; now?: () => Date } = {}) =>
    createCityAssistant({ ...toolDeps(extra.now), cities, model, ...extra });

  it("runs the tools Claude asks for, a step each, and answers with only the places they returned", async () => {
    const model = nightCheck();
    const events = await collect(assistant(model).ask(question("Is Old Town okay at 11 tonight?")));

    expect(events.filter((e) => e.type === "step").map((e) => e.type === "step" && e.label)).toEqual([
      "Looking up Old Town",
      "Checking Old Town at 23:00",
    ]);
    expect(events.find((e) => e.type === "answer")).toEqual({
      type: "answer",
      text: "[[p1]] is **brightly lit** with places open. Avoid  and Main Road.",
      places: { p1: { name: "Old Town", point: WEST } },
    });
    expect(events.at(-1)).toEqual({ type: "done", modelCalls: 3, toolCalls: 2, costUsd: expect.closeTo(0.03, 6) });

    const [, secondCall] = model.seen;
    expect(secondCall!.at(-1)).toMatchObject({ kind: "results", results: [{ callId: "t1", isError: false }] });
    expect(secondCall!.at(-2)).toMatchObject({ kind: "turn" });
  });

  it("strips refs from earlier turns so old text can't point at places", async () => {
    const model = scriptedModel(turn({ text: "Sure." }));
    await collect(
      assistant(model).ask({
        cityId: city.id,
        messages: [
          { role: "user", text: "Where can I stop?" },
          { role: "assistant", text: "Try [[p1]]." },
          { role: "user", text: "And after that?" },
        ],
      }),
    );
    expect(model.seen[0]![1]).toEqual({ kind: "text", role: "assistant", text: "Try p1." });
  });

  it("tells Claude near which area the rider shared their location, never the coordinates", async () => {
    const model = scriptedModel(
      turn({ stop: "tools", calls: [call("find_open_places", { category: "pharmacy", place: "me", time: "2026-11-14T23:30" }, "t1")] }),
      turn({ text: "Nearest to [[me]]: [[p1]]." }),
    );
    const events = await collect(assistant(model).ask({ ...question("Pharmacy near me?"), location: EAST }));

    const { context } = model.chat.mock.calls[0]![0];
    expect(context).toContain("shared their location");
    expect(`${context}${JSON.stringify(model.seen[1])}`).not.toMatch(/73\.84|18\.52/);
    expect(events.find((e) => e.type === "answer")).toMatchObject({ places: { me: { name: "Your location", point: EAST }, p1: { name: "pharmacy allnight" } } });

    const outside = scriptedModel(turn({ text: "Where are you?" }));
    await collect(assistant(outside).ask({ ...question("Pharmacy near me?"), location: [77.59, 12.97] }));
    expect(outside.chat.mock.calls[0]![0].context).toContain("outside Testville");

    const unshared = scriptedModel(turn({ text: "Where are you? [[me]]" }));
    const reply = await collect(assistant(unshared).ask(question("Pharmacy near me?")));
    expect(unshared.chat.mock.calls[0]![0].context).toContain("hasn't shared");
    expect(reply.find((e) => e.type === "answer")).toMatchObject({ text: "Where are you?", places: {} });
  });

  it("replaces an answer that slipped into code with what the guide is for", async () => {
    const model = scriptedModel(turn({ text: "Sure:\n```python\ndef is_prime(n):\n    return n > 1\n```" }));
    const events = await collect(assistant(model).ask(question("program to find a prime number")));
    expect(events.find((e) => e.type === "answer")).toEqual({ type: "answer", text: expect.stringContaining("only help with getting around"), places: {} });
  });

  it("stops after six model calls when Claude keeps asking for tools", async () => {
    const looping = Array.from({ length: 8 }, (_, i) => turn({ stop: "tools", calls: [call("daylight", {}, `t${i}`)] }));
    const model = scriptedModel(...looping);
    const events = await collect(assistant(model).ask(question("Tell me everything")));
    expect(model.chat).toHaveBeenCalledTimes(6);
    expect(events.find((e) => e.type === "answer")).toMatchObject({ text: expect.stringContaining("one thing at a time") });
  });

  it("refuses new questions once today's budget is spent and opens again the next UTC day", async () => {
    let now = NIGHT;
    const model = scriptedModel(turn({ text: "First", costUsd: 0.03 }), turn({ text: "Next day" }));
    const guide = assistant(model, { dailyBudgetUsd: 0.02, now: () => now });

    await collect(guide.ask(question("One")));
    let refusal: unknown;
    try {
      guide.ask(question("Two"));
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toMatchObject({ statusCode: 429, code: "DAILY_LIMIT" });
    now = new Date(NIGHT.getTime() + DAY_MS);
    expect((await collect(guide.ask(question("Three")))).find((e) => e.type === "answer")).toMatchObject({ text: "Next day" });
  });

  it("turns a model outage into an error event without upstream details", async () => {
    const model = scriptedModel();
    model.chat.mockRejectedValueOnce(new UpstreamError("City assistant", 529));
    const events = await collect(assistant(model).ask(question("Hello")));
    expect(events[0]).toMatchObject({ type: "error", code: "UNAVAILABLE" });
    expect(JSON.stringify(events[0])).not.toContain("529");
    expect(events.at(-1)).toMatchObject({ type: "done", failure: { status: 529 } });
  });
});

describe("city assistant API", () => {
  const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const verifier: TokenVerifier = {
    verify: async () => {
      throw unauthorized();
    },
  };
  const setup = async (model?: ReturnType<typeof scriptedModel>, dailyBudgetUsd?: number) => {
    const assistant = model ? createCityAssistant({ ...toolDeps(), cities, model, now: () => NIGHT, ...(dailyBudgetUsd ? { dailyBudgetUsd } : {}) }) : undefined;
    return buildApp({ env, verifier, cities, ...(assistant ? { assistant } : {}) });
  };
  const ask = (app: Awaited<ReturnType<typeof setup>>, payload: object) => app.inject({ method: "POST", url: "/api/assistant", payload });
  const frames = (body: string) =>
    body
      .split("\n\n")
      .filter(Boolean)
      .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as { type: string; [key: string]: unknown });

  it("streams steps and the answer to a guest as server-sent events, without cost", async () => {
    const app = await setup(nightCheck());
    const res = await ask(app, question("Is Old Town okay at 11 tonight?"));

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    const events = frames(res.body);
    expect(events.map((e) => e.type)).toEqual(["step", "step", "answer"]);
    expect(events[2]).toMatchObject({ places: { p1: { name: "Old Town", point: WEST } }, route: null });
    expect(res.body).not.toContain("cost");
  });

  it("sends the last planned route with the answer so the app can show it", async () => {
    const model = scriptedModel(
      turn({ stop: "tools", calls: [call("plan_route", { from: "Old Town", to: "River Gate", depart_at: "2026-11-14T23:00" })] }),
      turn({ text: "Take the main road." }),
    );
    const events = frames((await ask(await setup(model), question("Route from Old Town to River Gate at 11?"))).body);
    expect(events.at(-1)).toMatchObject({
      type: "answer",
      route: { from: { name: "Old Town", point: WEST }, to: { name: "River Gate", point: EAST }, departAt: NIGHT.toISOString() },
    });
  });

  it("validates the conversation and says when the assistant is off or spent for the day", async () => {
    const off = await setup();
    expect((await ask(off, question("Hi"))).json().error.code).toBe("NOT_CONFIGURED");
    expect((await off.inject({ method: "GET", url: "/api/config" })).json().assistant).toBe(false);

    const app = await setup(scriptedModel(turn({ text: "Hello", costUsd: 0.05 })), 0.01);
    expect((await app.inject({ method: "GET", url: "/api/config" })).json().assistant).toBe(true);
    const invalid = [
      { cityId: city.id, messages: [] },
      { cityId: city.id, messages: [{ role: "user", text: "x".repeat(1001) }] },
      { cityId: city.id, messages: [{ role: "assistant", text: "Hi" }] },
      { cityId: city.id, messages: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello" }] },
      { cityId: city.id, messages: Array.from({ length: 13 }, () => ({ role: "user", text: "Hi" })) },
      { ...question("Hi"), extra: true },
      { ...question("Hi"), location: [200, 18.5] },
      { ...question("Hi"), location: { lon: 73.8, lat: 18.5 } },
    ];
    for (const payload of invalid) expect((await ask(app, payload)).statusCode).toBe(400);
    expect((await ask(app, { ...question("Hi"), cityId: "atlantis" })).statusCode).toBe(404);

    expect((await ask(app, { ...question("Hi"), location: EAST })).statusCode).toBe(200);
    const spent = await ask(app, question("Again"));
    expect(spent.statusCode).toBe(429);
    expect(spent.json().error.code).toBe("DAILY_LIMIT");
  });
});

describe("Anthropic chat client", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const thinking = { type: "thinking", thinking: "Check the area first.", signature: "sig-1" };

  it("asks Sonnet with tools, cached rules and between-tool thinking, and prices the reply from its usage", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({
        content: [thinking, { type: "text", text: "Let me check." }, { type: "tool_use", id: "t1", name: "check_area", input: { place: "p1" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: null },
      }),
    );
    const model = new AnthropicChatModel("test-key", fetchImpl);
    const tools = [{ name: "check_area", description: "Area", inputSchema: { type: "object", properties: {} } }];
    const reply = await model.chat({ system: "rules", context: "now", tools, messages: [{ kind: "text", role: "user", text: "Hi" }], maxTokens: 1500 });

    expect(reply).toMatchObject({ text: "Let me check.", stop: "tools", calls: [{ id: "t1", name: "check_area", input: { place: "p1" } }] });
    expect(reply.costUsd).toBeCloseTo(0.0115, 10);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2026-10-21" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 1500,
      system: [
        { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
        { type: "text", text: "now" },
      ],
      tools: [{ name: "check_area", description: "Area", input_schema: { type: "object", properties: {} } }],
      messages: [{ role: "user", content: "Hi" }],
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
    });

    await model.chat({
      system: "rules",
      context: "now",
      tools,
      messages: [
        { kind: "text", role: "user", text: "Hi" },
        { kind: "turn", turn: reply },
        { kind: "results", results: [{ callId: "t1", content: "No such place", isError: true }] },
      ],
      maxTokens: 1500,
    });
    const sent = JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)) as { messages: unknown[] };
    expect(sent.messages[1]).toEqual({ role: "assistant", content: [thinking, { type: "text", text: "Let me check." }, expect.objectContaining({ type: "tool_use", id: "t1" })] });
    expect(sent.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "No such place", is_error: true }] });
  });

  it("maps refusals and cut-off replies, and never puts the key in errors", async () => {
    const reply = (stop_reason: string) => json({ content: [{ type: "text", text: "..." }], stop_reason, usage: { input_tokens: 1, output_tokens: 1 } });
    const ask = (fetchImpl: typeof fetch) =>
      new AnthropicChatModel("test-key", fetchImpl).chat({ system: "s", context: "c", tools: [], messages: [{ kind: "text", role: "user", text: "Hi" }], maxTokens: 10 });

    expect((await ask(async () => reply("refusal"))).stop).toBe("refused");
    expect((await ask(async () => reply("max_tokens"))).stop).toBe("truncated");
    expect((await ask(async () => reply("end_turn"))).stop).toBe("done");
    const error = await ask(async () => json({ type: "error", error: { type: "authentication_error", message: "test-key invalid" } }, 401)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(String(error)).not.toContain("test-key");
  });
});
