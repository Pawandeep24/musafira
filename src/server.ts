import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { getFirebaseApp } from "./auth/firebaseApp.js";
import { FirebaseTokenVerifier } from "./auth/tokenVerifier.js";
import { loadCityRegistry } from "./city/cityRegistry.js";
import { loadEnv } from "./config/env.js";
import { getDb } from "./db/firestore.js";
import { createFirestorePreferencesStore } from "./db/preferencesStore.js";
import { createFirestoreReportStore } from "./db/reportStore.js";
import { AnthropicTextModel } from "./integrations/anthropic/client.js";
import { createGoDaddyClient } from "./integrations/godaddy/factory.js";
import { OrsGeocoder } from "./integrations/ors/geocoder.js";
import { TomTomTrafficFlow } from "./integrations/tomtom/trafficFlow.js";
import { ValhallaClient } from "./integrations/valhalla/client.js";
import { createCommunityReports } from "./planner/communityReports.js";
import { createItineraryPlanner } from "./planner/itineraryPlanner.js";
import { createRoutePlanner } from "./planner/routePlanner.js";

const env = loadEnv();
const firebase = getFirebaseApp(env);
const db = getDb(firebase);
const godaddy = createGoDaddyClient(env);
const cities = await loadCityRegistry(fileURLToPath(new URL("../data/cities", import.meta.url)));
const reports = createCommunityReports({ store: createFirestoreReportStore(db), cities });
const webRoot = fileURLToPath(new URL("../web/dist", import.meta.url));

const app = await buildApp({
  env,
  verifier: new FirebaseTokenVerifier(firebase),
  db,
  godaddy,
  cities,
  planner: createRoutePlanner({
    cities,
    routing: new ValhallaClient({ baseUrl: env.VALHALLA_URL }),
    ...(env.TOMTOM_API_KEY ? { traffic: new TomTomTrafficFlow(env.TOMTOM_API_KEY) } : {}),
    reports,
  }),
  itineraries: createItineraryPlanner({
    cities,
    ...(env.ANTHROPIC_API_KEY ? { model: new AnthropicTextModel(env.ANTHROPIC_API_KEY) } : {}),
    dailyBudgetUsd: env.ANTHROPIC_DAILY_BUDGET_USD,
  }),
  ...(env.ORS_API_KEY ? { geocoder: new OrsGeocoder(env.ORS_API_KEY) } : {}),
  preferences: createFirestorePreferencesStore(db),
  reports,
  ...(existsSync(join(webRoot, "index.html")) ? { webRoot } : {}),
});

reports.load().then(
  (count) => app.log.info({ count }, "rider reports loaded"),
  (err: unknown) => app.log.warn({ reason: err instanceof Error ? err.message : String(err) }, "Could not load rider reports - starting with none"),
);

app.log.info({ cities: cities.cities.map((c) => `${c.id}@${c.data.version}`) }, "city data loaded");
if (cities.cities.length === 0) app.log.warn("No city data in data/cities - run `npm run ingest`");
if (!env.TOMTOM_API_KEY) app.log.warn("No TOMTOM_API_KEY - crowd scores use open places only");
if (!env.ORS_API_KEY) app.log.warn("No ORS_API_KEY - place search uses city data only; reverse lookup returns 503");
if (!env.ANTHROPIC_API_KEY) app.log.warn("No ANTHROPIC_API_KEY - trip plans use the basic planner only");
if (!godaddy) app.log.warn(`No GoDaddy credentials for "${env.GODADDY_ENV}" - /api/domains/* will return 503`);
if (env.GODADDY_ENV === "production") app.log.warn("GoDaddy client is pointed at PRODUCTION");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
