import { buildApp } from "./app.js";
import { getFirebaseApp } from "./auth/firebaseApp.js";
import { FirebaseTokenVerifier } from "./auth/tokenVerifier.js";
import { loadEnv } from "./config/env.js";
import { getDb } from "./db/firestore.js";
import { GoDaddyClient } from "./integrations/godaddy/client.js";
import { StaticTokenProvider } from "./integrations/godaddy/tokenProvider.js";

const env = loadEnv();
const firebase = getFirebaseApp(env);

const godaddy = env.GODADDY_PAT
  ? new GoDaddyClient({ tokenProvider: new StaticTokenProvider(env.GODADDY_PAT), env: env.GODADDY_ENV })
  : undefined;

const app = await buildApp({
  env,
  verifier: new FirebaseTokenVerifier(firebase),
  db: getDb(firebase),
  godaddy,
});

if (!godaddy) app.log.warn("GODADDY_PAT not set - /api/domains/* will return 503");
if (env.GODADDY_ENV === "production") app.log.warn("GoDaddy client is pointed at PRODUCTION");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
