import type { Env } from "#src/config/env.js";
import { GoDaddyClient } from "#src/integrations/godaddy/client.js";
import { StaticTokenProvider } from "#src/integrations/godaddy/tokenProvider.js";

export function createGoDaddyClient(env: Env): GoDaddyClient | undefined {
  const credentials =
    env.GODADDY_ENV === "ote"
      ? { key: env.GODADDY_OTE_API_KEY, secret: env.GODADDY_OTE_API_SECRET }
      : { key: env.GODADDY_PRODUCTION_API_KEY, secret: env.GODADDY_PRODUCTION_API_SECRET };

  if (!credentials.key || !credentials.secret) return undefined;

  return new GoDaddyClient({
    tokenProvider: new StaticTokenProvider(`${credentials.key}:${credentials.secret}`),
    env: env.GODADDY_ENV,
  });
}
