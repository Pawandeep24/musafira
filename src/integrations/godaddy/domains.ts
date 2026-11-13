import type { GoDaddyClient } from "./client.js";

export interface DomainAvailability {
  available: boolean;
  definitive?: boolean;
  domain: string;
  price?: number;
  currency?: string;
  period?: number;
}

export function checkDomainAvailability(client: GoDaddyClient, domain: string) {
  return client.request<DomainAvailability>("/v1/domains/available", { query: { domain } });
}
