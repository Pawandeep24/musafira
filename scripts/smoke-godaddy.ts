import { loadEnv } from "#src/config/env.js";
import { GoDaddyApiError } from "#src/integrations/godaddy/client.js";
import { checkDomainAvailability } from "#src/integrations/godaddy/domains.js";
import { createGoDaddyClient } from "#src/integrations/godaddy/factory.js";

const env = loadEnv();
const domain = process.argv[2] ?? "my-hackathon-idea-2026.com";
const client = createGoDaddyClient(env);

if (!client) {
  console.error(`No GoDaddy key/secret configured for GODADDY_ENV="${env.GODADDY_ENV}".`);
  process.exit(1);
}

console.log(`env=${env.GODADDY_ENV} domain=${domain}`);

try {
  console.log("OK", JSON.stringify(await checkDomainAvailability(client, domain), null, 2));
} catch (err) {
  if (err instanceof GoDaddyApiError) {
    console.error(`FAILED: HTTP ${err.status} ${err.code ?? ""} ${err.message}`);
    if (err.status === 401) console.error("Hint: key/secret wrong for this environment, or revoked.");
    if (err.status === 403) console.error("Hint: the account is not eligible for this call.");
  } else {
    console.error("FAILED:", err);
  }
  process.exit(1);
}
