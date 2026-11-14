import type { z } from "zod";

/** An outbound call failed. `service` is safe to show; nothing else from upstream is exposed. */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status?: number,
  ) {
    super(`${service} request failed${status ? ` with HTTP ${status}` : ""}`);
    this.name = "UpstreamError";
  }
}

export interface JsonRequest {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export async function fetchJson<T>(
  fetchImpl: typeof fetch,
  service: string,
  url: string,
  schema: z.ZodType<T>,
  { method = "GET", headers = {}, body, timeoutMs = 10_000 }: JsonRequest = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UpstreamError(service);
  }
  if (!response.ok) throw new UpstreamError(service, response.status);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new UpstreamError(service, response.status);
  return parsed.data;
}
