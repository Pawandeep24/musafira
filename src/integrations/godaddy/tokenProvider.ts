import { inspect } from "node:util";

/**
 * Supplies the credential for outbound API calls.
 *
 * Today GoDaddy uses a static Personal Access Token. If we later need OAuth (e.g. acting on
 * a customer's GoDaddy store) we add another implementation that refreshes tokens - the HTTP
 * client does not change.
 */
export interface TokenProvider {
  getToken(): Promise<string>;
  /** Called after a 401 so refreshing providers can drop a stale token. Optional. */
  invalidate?(): void;
}

export class StaticTokenProvider implements TokenProvider {
  readonly #token: string;

  constructor(token: string) {
    if (!token.trim()) throw new Error("StaticTokenProvider requires a non-empty token");
    this.#token = token.trim();
  }

  async getToken(): Promise<string> {
    return this.#token;
  }

  // Prevent accidental leaks via console.log / JSON.stringify / util.inspect.
  toJSON() {
    return { type: "StaticTokenProvider", token: "[REDACTED]" };
  }
  [inspect.custom]() {
    return "StaticTokenProvider { token: [REDACTED] }";
  }
}
