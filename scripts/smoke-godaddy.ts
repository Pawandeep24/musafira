/**
 * Verifies your GoDaddy PAT works. Read-only (domain availability check) - no charges.
 *   npm run smoke:godaddy [-- example.com]
 */
import { loadEnv } from "../src/config/env.js";
import { GoDaddyApiError, GoDaddyClient } from "../src/integrations/godaddy/client.js";
import { checkDomainAvailability } from "../src/integrations/godaddy/domains.js";
import { StaticTokenProvider } from "../src/integrations/godaddy/tokenProvider.js";

const env = loadEnv();
if (!env.GODADDY_PAT) {
  console.error("GODADDY_PAT is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

const domain = process.argv[2] ?? "my-hackathon-idea-2026.com";
const client = new GoDaddyClient({ tokenProvider: new StaticTokenProvider(env.GODADDY_PAT), env: env.GODADDY_ENV });

console.log(`GoDaddy env: ${env.GODADDY_ENV}; checking "${domain}"...`);
try {
  const result = await checkDomainAvailability(client, domain);
  console.log("OK:", JSON.stringify(result, null, 2));
} catch (err) {
  if (err instanceof GoDaddyApiError) {
    console.error(`FAILED: HTTP ${err.status} ${err.code ?? ""} - ${err.message}`);
    if (err.status === 401) console.error("Hint: token invalid/expired, or created for a different environment (OTE vs production).");
    if (err.status === 403) console.error("Hint: token is missing the domains.domain:read scope, or the account is not eligible.");
  } else {
    console.error("FAILED:", err);
  }
  process.exit(1);
}
