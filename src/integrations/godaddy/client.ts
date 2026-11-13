import type { TokenProvider } from "./tokenProvider.js";

export const GODADDY_BASE_URLS = {
  ote: "https://api.ote-godaddy.com",
  production: "https://api.godaddy.com",
} as const;

export type GoDaddyEnv = keyof typeof GODADDY_BASE_URLS;

/** Error from a GoDaddy API call. Never contains credentials or request headers. */
export class GoDaddyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GoDaddyApiError";
  }
}

export interface GoDaddyClientOptions {
  tokenProvider: TokenProvider;
  env?: GoDaddyEnv;
  /** Override base URL (tests). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Total attempts including the first. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Injectable for tests so retries don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Required for POST to be retried safely. */
  idempotencyKey?: string;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const SAFE_TO_RETRY_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

export class GoDaddyClient {
  readonly #tokens: TokenProvider;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: GoDaddyClientOptions) {
    this.#tokens = opts.tokenProvider;
    this.#baseUrl = opts.baseUrl ?? GODADDY_BASE_URLS[opts.env ?? "ote"];
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
    this.#maxAttempts = opts.maxAttempts ?? 3;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const url = this.#buildUrl(path, opts.query);
    const canRetry = SAFE_TO_RETRY_METHODS.has(method) || Boolean(opts.idempotencyKey);
    let refreshedAfter401 = false;

    for (let attempt = 1; ; attempt++) {
      const token = await this.#tokens.getToken();
      const headers: Record<string, string> = {
        Authorization: `sso-key ${token}`,
        Accept: "application/json",
      };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

      let res: Response;
      try {
        res = await this.#fetch(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (err) {
        // Network error / timeout.
        if (canRetry && attempt < this.#maxAttempts) {
          await this.#sleep(backoffMs(attempt));
          continue;
        }
        const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error";
        throw new GoDaddyApiError(0, "NETWORK", `GoDaddy request ${reason}`);
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      // Stale/expired credential: let refreshing providers drop it, retry once.
      if (res.status === 401 && this.#tokens.invalidate && !refreshedAfter401) {
        refreshedAfter401 = true;
        this.#tokens.invalidate();
        await res.body?.cancel();
        continue;
      }

      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < this.#maxAttempts) {
        await res.body?.cancel();
        await this.#sleep(retryAfter !== undefined ? retryAfter * 1000 : backoffMs(attempt));
        continue;
      }

      throw await toApiError(res, retryAfter);
    }
  }

  #buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path, this.#baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }
}

function backoffMs(attempt: number): number {
  const base = Math.min(250 * 2 ** (attempt - 1), 4_000);
  return base + Math.floor(Math.random() * 100); // jitter
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs, 30) : undefined;
}

async function toApiError(res: Response, retryAfter: number | undefined): Promise<GoDaddyApiError> {
  let code: string | undefined;
  let message = `GoDaddy API responded ${res.status}`;
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // non-JSON error body; keep generic message
  }
  return new GoDaddyApiError(res.status, code, message, retryAfter);
}
