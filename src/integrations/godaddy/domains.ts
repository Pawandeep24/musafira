import type { GoDaddyClient } from "./client.js";

export interface DomainAvailability {
  available: boolean;
  definitive?: boolean;
  domain: string;
  prices?: Array<{
    period: number;
    term: string;
    price: { currencyCode: string; value: number };
    renewalPrice?: { currencyCode: string; value: number };
  }>;
}

/** Requires a PAT with the `domains.domain:read` scope. Read-only, no charges. */
export function checkDomainAvailability(client: GoDaddyClient, domain: string) {
  return client.request<DomainAvailability>("/v3/domains/check-availability", {
    query: { domain },
  });
}
