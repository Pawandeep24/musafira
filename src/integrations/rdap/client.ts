/**
 * Finds a domain's registrar through RDAP, the registries' JSON successor to WHOIS.
 *
 * rdap.org redirects each query to the registry for the domain's TLD (Verisign for .com,
 * NIXI for .in). 404 means the domain isn't registered. The registrar is the entity whose
 * roles include "registrar"; its name is the vCard `fn` entry, e.g.
 *   ["fn", {}, "text", "GoDaddy.com, LLC"]
 */
import { z } from "zod";
import { fetchJson, UpstreamError } from "../../lib/http.js";

const SERVICE = "Domain registry";

const rdapDomain = z.object({
  entities: z
    .array(
      z.object({
        roles: z.array(z.string()).default([]),
        vcardArray: z.tuple([z.literal("vcard"), z.array(z.array(z.unknown()))]).optional(),
      }),
    )
    .default([]),
});

export interface RdapClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class RdapClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor({ baseUrl = "https://rdap.org", fetchImpl = fetch, timeoutMs = 10_000 }: RdapClientOptions = {}) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async registrar(domain: string): Promise<string | undefined> {
    const reply = await fetchJson(this.#fetch, SERVICE, `${this.#baseUrl}/domain/${encodeURIComponent(domain)}`, rdapDomain, {
      headers: { Accept: "application/rdap+json, application/json" },
      timeoutMs: this.#timeoutMs,
    }).catch((error: unknown) => {
      if (error instanceof UpstreamError && error.status === 404) return undefined;
      throw error;
    });
    if (!reply) return undefined;
    const registrar = reply.entities.find((entity) => entity.roles.includes("registrar"));
    const name = registrar?.vcardArray?.[1].find((entry) => entry[0] === "fn")?.[3];
    return typeof name === "string" && name.trim() ? name.trim() : "Unknown registrar";
  }
}
