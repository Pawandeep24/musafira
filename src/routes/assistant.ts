import { Readable } from "node:stream";
import type { FastifyBaseLogger, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { LngLat } from "#src/geo/geometry.js";
import { AppError } from "#src/lib/errors.js";
import type { NamedPlace } from "#src/planner/assistantTools.js";
import type { AssistantEvent, CityAssistant } from "#src/planner/cityAssistant.js";
import { lngLatSchema } from "#src/routes/schemas.js";

const MAX_TURNS = 12;

const askBody = z
  .object({
    cityId: z.string().max(40),
    messages: z
      .array(
        z.discriminatedUnion("role", [
          z.object({ role: z.literal("user"), text: z.string().trim().min(1).max(1000) }).strict(),
          z.object({ role: z.literal("assistant"), text: z.string().trim().min(1).max(4000) }).strict(),
        ]),
      )
      .min(1)
      .max(MAX_TURNS)
      .refine((turns) => turns[0]?.role === "user" && turns.at(-1)?.role === "user", "Start and end with the rider's question"),
    location: lngLatSchema.optional(),
  })
  .strict();

const roundPoint = ([lon, lat]: LngLat): LngLat => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
const placeView = ({ name, point }: NamedPlace) => ({ name, point: roundPoint(point) });
const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

function eventView(event: Exclude<AssistantEvent, { type: "done" }>) {
  if (event.type !== "answer") return event;
  const { text, places, route } = event;
  return {
    type: "answer",
    text,
    places: Object.fromEntries(Object.entries(places).map(([ref, place]) => [ref, placeView(place)])),
    route: route ? { from: placeView(route.from), to: placeView(route.to), departAt: route.departAt.toISOString() } : null,
  };
}

async function* serverSentEvents(events: AsyncGenerator<AssistantEvent>, log: FastifyBaseLogger) {
  try {
    for await (const event of events) {
      if (event.type === "done") {
        const stats = { modelCalls: event.modelCalls, toolCalls: event.toolCalls, costUsd: Math.round(event.costUsd * 10_000) / 10_000 };
        if (event.failure) log.warn({ ...stats, upstreamStatus: event.failure.status }, "city assistant could not reach Claude");
        else log.info(stats, "city assistant answered");
      } else {
        yield frame(eventView(event));
      }
    }
  } catch (err) {
    log.error(err, "city assistant failed");
    yield frame({ type: "error", code: "UNAVAILABLE", message: "The city assistant can't answer right now. Try again in a minute." });
  }
}

/** Public: anyone can ask. Each question is a few Sonnet calls, so it is bounded per IP and by the service's daily budget. */
export const assistantRoutes =
  ({ assistant }: { assistant?: CityAssistant }): FastifyPluginAsync =>
  async (app) => {
    app.post("/assistant", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
      if (!assistant) throw new AppError(503, "NOT_CONFIGURED", "The city assistant is not configured");
      const question = askBody.parse(req.body);
      const disconnected = new AbortController();
      reply.raw.on("close", () => disconnected.abort());
      const events = assistant.ask(question, disconnected.signal);
      return reply
        .type("text/event-stream; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .header("X-Accel-Buffering", "no")
        .send(Readable.from(serverSentEvents(events, req.log)));
    });
  };
