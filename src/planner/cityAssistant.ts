/**
 * Application service behind POST /api/assistant: Claude (Sonnet) answers a rider's question about a
 * city, calling the tools in assistantTools.ts for anything that depends on Musafira's data.
 *
 *   ask() → city → tool session → up to 6 model calls; each reply either asks for tools (run in
 *           parallel, a "step" event each, results fed back) or answers → "answer" event with the
 *           places it mentions and the last route planned → "done" with counts, cost and any model
 *           failure (for logs, never sent to the rider)
 *
 * Spend is summed per UTC day from each reply's cost. Once it reaches dailyBudgetUsd new questions are
 * refused; a question already running finishes, so the cap can be passed by one question (cents).
 *
 * The answer can only point at places the tools returned: [[pN]] refs this question issued become
 * entries in `places`, unknown refs are dropped and other bracketed text stays as plain text. Earlier
 * turns arrive as plain text with brackets stripped, so old text can't mint refs. Replies are plain
 * text by design, so one with a code block is off topic by definition and is swapped for a reminder
 * of what the guide is for.
 *
 * A shared location becomes the place "me" only inside the city; Claude is told the nearest area
 * name, or that it is outside the city or not shared, never the coordinates.
 */
import { assistantContext, ASSISTANT_RULES } from "#src/assistant/prompt.js";
import type { CityIndex } from "#src/city/cityIndex.js";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import { createHoursEvaluator, type HoursEvaluator } from "#src/city/openingHours.js";
import { AppError } from "#src/lib/errors.js";
import type { LngLat } from "#src/geo/geometry.js";
import { UpstreamError } from "#src/lib/http.js";
import { createToolSession, RIDER_REF, type AssistantToolDeps, type NamedPlace, type RouteIdea, type ToolSession } from "#src/planner/assistantTools.js";
import type { ChatMessage, ChatModel, ChatTurn, ToolOutcome } from "#src/planner/ports.js";

const MAX_MODEL_CALLS = 6;
const MAX_TOOLS_PER_STEP = 4;
const MAX_TOKENS = 1500;

export interface AssistantTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface AssistantQuestion {
  readonly cityId: string;
  readonly messages: readonly AssistantTurn[];
  readonly location?: LngLat;
}

interface Usage {
  modelCalls: number;
  toolCalls: number;
  costUsd: number;
}

export type AssistantUsage = Readonly<Usage>;

export type AssistantEvent =
  | { readonly type: "step"; readonly label: string }
  | { readonly type: "answer"; readonly text: string; readonly places: Readonly<Record<string, NamedPlace>>; readonly route?: RouteIdea }
  | { readonly type: "error"; readonly code: "UNAVAILABLE"; readonly message: string }
  | ({ readonly type: "done"; readonly failure?: { readonly status?: number } } & AssistantUsage);

export interface CityAssistant {
  /** Throws before streaming for an unknown city or a spent daily budget. */
  ask(question: AssistantQuestion, signal?: AbortSignal): AsyncGenerator<AssistantEvent>;
}

export interface CityAssistantDeps extends Omit<AssistantToolDeps, "now"> {
  readonly cities: CityRegistry;
  readonly model: ChatModel;
  readonly dailyBudgetUsd?: number;
  readonly now?: () => Date;
}

const TOO_MANY_STEPS = "That needed more look-ups than I can do in one go. Try asking about one thing at a time.";
const NO_ANSWER = "I couldn't find an answer to that. Try asking another way.";
const OFF_TOPIC = "I can only help with getting around the city: places, what's open, routes, washrooms and safety. Try asking about one of those.";
const CODE_BLOCK = /```/;

function answerFrom(turn: ChatTurn, session: ToolSession): AssistantEvent {
  if (CODE_BLOCK.test(turn.text)) return { type: "answer", text: OFF_TOPIC, places: {} };
  const places: Record<string, NamedPlace> = {};
  const text = turn.text.replace(/\[\[([^\]\n]{1,60})\]\]/g, (_, inner: string) => {
    const ref = inner.trim().toLowerCase();
    const place = session.places.get(ref);
    if (place) {
      places[ref] = place;
      return `[[${ref}]]`;
    }
    return /^p\d+$/.test(ref) || ref === RIDER_REF ? "" : inner;
  });
  const route = session.route();
  return { type: "answer", text: text.trim() || NO_ANSWER, places, ...(route ? { route } : {}) };
}

export function createCityAssistant({ cities, model, dailyBudgetUsd = 2, now = () => new Date(), ...toolDeps }: CityAssistantDeps): CityAssistant {
  const hoursByCity = new Map<string, HoursEvaluator>(
    cities.cities.map((c) => [c.id, createHoursEvaluator(c.data.center, c.data.utcOffsetMinutes)]),
  );
  let spendDay = "";
  let spentUsd = 0;
  const spentToday = () => {
    const day = now().toISOString().slice(0, 10);
    if (day !== spendDay) {
      spendDay = day;
      spentUsd = 0;
    }
    return spentUsd;
  };

  async function* converse(city: CityIndex, { messages: history, location }: AssistantQuestion, usage: Usage, signal?: AbortSignal): AsyncGenerator<AssistantEvent> {
    const here = location && city.contains(location) ? location : undefined;
    const session = createToolSession({ ...toolDeps, now }, city, hoursByCity.get(city.id)!, here);
    const area = here && city.places.areaNear(here);
    const context = assistantContext({
      cityName: city.data.name,
      coveredCities: cities.cities.map((c) => c.data.name),
      now: now(),
      utcOffsetMinutes: city.data.utcOffsetMinutes,
      rider: here ? { inCity: true, ...(area ? { area } : {}) } : location ? { inCity: false } : undefined,
    });
    const messages: ChatMessage[] = history.map((m) => ({ kind: "text", role: m.role, text: m.text.replace(/\[\[|\]\]/g, "") }));

    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      if (signal?.aborted) return;
      const turn = await model.chat({ system: ASSISTANT_RULES, context, tools: session.specs, messages, maxTokens: MAX_TOKENS });
      usage.modelCalls++;
      usage.costUsd += turn.costUsd;
      spentToday();
      spentUsd += turn.costUsd;
      messages.push({ kind: "turn", turn });
      if (turn.stop !== "tools" || turn.calls.length === 0) {
        yield answerFrom(turn, session);
        return;
      }
      for (const toolCall of turn.calls.slice(0, MAX_TOOLS_PER_STEP)) yield { type: "step", label: session.label(toolCall) };
      const results = await Promise.all(
        turn.calls.map(
          (toolCall, i): Promise<ToolOutcome> =>
            i < MAX_TOOLS_PER_STEP ? session.run(toolCall) : Promise.resolve({ callId: toolCall.id, content: "Too many look-ups in one step", isError: true }),
        ),
      );
      usage.toolCalls += Math.min(turn.calls.length, MAX_TOOLS_PER_STEP);
      messages.push({ kind: "results", results });
    }
    yield { type: "answer", text: TOO_MANY_STEPS, places: {} };
  }

  async function* run(city: CityIndex, question: AssistantQuestion, signal?: AbortSignal): AsyncGenerator<AssistantEvent> {
    const usage: Usage = { modelCalls: 0, toolCalls: 0, costUsd: 0 };
    let failure: { status?: number } | undefined;
    try {
      yield* converse(city, question, usage, signal);
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      failure = err.status ? { status: err.status } : {};
      yield { type: "error", code: "UNAVAILABLE", message: "The city assistant can't answer right now. Try again in a minute." };
    }
    yield { type: "done", ...usage, ...(failure ? { failure } : {}) };
  }

  return {
    ask(question, signal) {
      const city = cities.cities.find((c) => c.id === question.cityId);
      if (!city) throw new AppError(404, "NOT_FOUND", "Unknown city");
      if (spentToday() >= dailyBudgetUsd) {
        throw new AppError(429, "DAILY_LIMIT", "The city assistant has answered all it can for today. Try again tomorrow.");
      }
      return run(city, question, signal);
    },
  };
}
