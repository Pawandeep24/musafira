/**
 * Claude Messages API with tools, fixed to Sonnet 5.5 for the city assistant: it has to choose tools,
 * read their results and decide what to do next, which Haiku does less reliably.
 *
 * Request: `thinking: between_tools` at low effort, so Claude answers without thinking up front and
 * only writes short notes between tool calls; both keep replies quick and cheap. The 2026-10-21 API
 * rejects sampling parameters and forced tool choice, so neither is sent. The fixed system text carries
 * a cache breakpoint: tools plus that text are the cached prefix every question and step repeats; the
 * per-request context (city, clock) follows it uncached.
 *
 * Tool loop contract: the assistant content comes back verbatim in `raw`, and is sent back unchanged,
 * since thinking blocks must survive the loop; tool results follow as one user message.
 *
 * Cost per reply from its usage block, Sonnet 5.5 prices per million tokens: $2 input, $10 output
 * (thinking included), $2.50 cache writes, $0.10 cache reads.
 */
import { z } from "zod";
import { API_VERSION, MESSAGES_URL } from "#src/integrations/anthropic/client.js";
import { fetchJson } from "#src/lib/http.js";
import type { ChatMessage, ChatModel, ChatRequest, ChatTurn, ToolCall } from "#src/planner/ports.js";

const MODEL = "claude-sonnet-5-5";
const PER_TOKEN = 1 / 1_000_000;
const USD = { input: 2 * PER_TOKEN, output: 10 * PER_TOKEN, cacheWrite: 2.5 * PER_TOKEN, cacheRead: 0.1 * PER_TOKEN };

const block = z.looseObject({ type: z.string() });
const textBlock = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() });
const messageResponse = z.object({
  content: z.array(block),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number().nullish(),
    cache_read_input_tokens: z.number().nullish(),
  }),
});

const STOPS: Readonly<Record<string, ChatTurn["stop"]>> = { tool_use: "tools", max_tokens: "truncated", refusal: "refused" };

function toApiMessage(message: ChatMessage) {
  switch (message.kind) {
    case "text":
      return { role: message.role, content: message.text };
    case "turn":
      return { role: "assistant", content: message.turn.raw };
    case "results":
      return {
        role: "user",
        content: message.results.map((r) => ({ type: "tool_result", tool_use_id: r.callId, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
      };
  }
}

export class AnthropicChatModel implements ChatModel {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat({ system, context, tools, messages, maxTokens }: ChatRequest): Promise<ChatTurn> {
    const reply = await fetchJson(this.fetchImpl, "City assistant", MESSAGES_URL, messageResponse, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      body: {
        model: MODEL,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
          { type: "text", text: context },
        ],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        messages: messages.map(toApiMessage),
        thinking: { type: "between_tools" },
        output_config: { effort: "low" },
      },
      timeoutMs: 45_000,
    });
    const calls: ToolCall[] = reply.content.flatMap((b) => {
      const use = toolUseBlock.safeParse(b);
      return use.success ? [{ id: use.data.id, name: use.data.name, input: use.data.input }] : [];
    });
    const { usage } = reply;
    return {
      text: reply.content
        .flatMap((b) => {
          const text = textBlock.safeParse(b);
          return text.success ? [text.data.text] : [];
        })
        .join("\n")
        .trim(),
      calls,
      stop: STOPS[reply.stop_reason ?? ""] ?? "done",
      raw: reply.content,
      costUsd:
        usage.input_tokens * USD.input +
        usage.output_tokens * USD.output +
        (usage.cache_creation_input_tokens ?? 0) * USD.cacheWrite +
        (usage.cache_read_input_tokens ?? 0) * USD.cacheRead,
    };
  }
}
