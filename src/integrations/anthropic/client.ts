/**
 * Claude Messages API, fixed to Haiku: the cheapest model, and choosing stops from a given list needs
 * no more. Cost comes from the reply's usage block at Haiku's price per million tokens (prompts up to
 * 100k: $0.10 input, $0.50 output) so the planner can hold a daily budget. API version 2026-10-21
 * rejects sampling parameters (temperature, top_p, top_k), so none are sent.
 */
import { z } from "zod";
import { fetchJson } from "#src/lib/http.js";
import type { TextModel, TextReply, TextRequest } from "#src/planner/ports.js";

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2026-10-21";
const MODEL = "claude-haiku-5-5";
const USD_PER_INPUT_TOKEN = 0.1 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 0.5 / 1_000_000;

const messageResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export class AnthropicTextModel implements TextModel {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete({ system, prompt, maxTokens }: TextRequest): Promise<TextReply> {
    const reply = await fetchJson(this.fetchImpl, "Trip assistant", MESSAGES_URL, messageResponse, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
      body: { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] },
      timeoutMs: 20_000,
    });
    return {
      text: reply.content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n"),
      costUsd: reply.usage.input_tokens * USD_PER_INPUT_TOKEN + reply.usage.output_tokens * USD_PER_OUTPUT_TOKEN,
    };
  }
}
