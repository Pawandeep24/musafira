# Musafira

**Safer routes for the hour you ride.** For each trip Musafira compares up to three two-wheeler routes. It works out when you'll reach each 100 m of the road and scores it for that minute: streetlight after dusk, open police and 24-hour help points, people around, mobile signal, hospitals and fuel, shops still open, breakdown help and road type. Riders tune what matters through their "safety DNA" (weights and presets). A ride preview then flies the camera along the route and warns about dark stretches and dead zones before you reach them.

Built for the GoDaddy Inclusive Innovation Hackathon 2026. Covers Pune and Bengaluru.

## Architecture

```
web/ (React · MapLibre · deck.gl)
   │  /api (Vite proxy in dev)
   ▼
API (Fastify) ──▶ Valhalla        two-wheeler routes, road classes
   │          ├─▶ TomTom Flow     live traffic (only when leaving now)
   │          ├─▶ openrouteservice addresses the city index doesn't know
   │          ├─▶ Namma Yatri     live auto fares, booking and ride status (Bengaluru)
   │          ├─▶ GoDaddy · RDAP · DNS  Safe Stop domain ideas and proof of ownership
   │          └─▶ Firestore       signed-in riders' preferences, rider reports, Safe Stop listings
   ▼
data/cities/*.json  ◀── npm run ingest (OSM POIs, named places and public toilets, NASA Black Marble, OpenCelliD)
```

Place search answers from an in-memory index of each city's named places: housing societies, areas, landmarks, streets and POIs (about 17,600 in Pune and 52,000 in Bengaluru). It matches as you type, tolerates typos and transliteration ("Pruthvi" finds "Prithvi"), and answers in a few milliseconds. openrouteservice only tops up when the index has little to offer. See `src/city/placeSearch.ts`.

Signed-in riders can report what they saw at a spot: poor lighting, a deserted stretch, harassment, a bad road, police nearby and so on. Reports correct the sensor-based scores for riders passing at a similar hour and fade over weeks; harassment and loitering add a penalty that no slider can switch off. After a search, reports around the trip rise on the 3D map as pillars, bright where they count for the selected route. They are stored without the reporter's identity. See `src/safety/community.ts`.

Day trips start from a base place and four quick questions: how long, interests, diet and when to be back. `POST /api/itinerary` offers Claude Haiku a numbered list of real places near the base, and Haiku replies with one short line per stop (about $0.0006 a plan). The server then sets the times in city time, checks opening hours, keeps rides before dusk unless the rider chose a later return, and flags any ride after dark. Any leg opens in the route planner for a safety check. Without `ANTHROPIC_API_KEY`, or after the daily spend cap, the same places are planned without AI. See `src/itinerary/`.

**Book this route** hands the safe route to an auto. Musafira places a few safety checkpoints where a car would otherwise leave the safe route and sends them as stops, so both the route and the fare go through them. It shows the fare and safety score of that ride next to the usual route. During the ride it tracks the driver and alerts the rider, with Share trip and Call 112, if the ride strays more than 100 m from the route. In Bengaluru the ride is booked for real on the rider's own Namma Yatri account: they link it with a 2-minute code from the app (Profile → About us → tap the version number), and the sign-in stays on the server for 12 hours, never in the browser. Pune, and anyone without an account, gets a demo ride with meter fares and a simulated driver; nothing is booked. Live booking is off unless `NAMMA_YATRI_LIVE=true`; until then every city gets the demo. See `src/planner/rideBooking.ts`.

**Washrooms near me** lists open washrooms within a short ride, ranked by ride time: Musafira Safe Stops first, then OpenStreetMap public toilets (94 in Pune, 495 in Bengaluru) and fuel stations, which must keep a washroom for customers. Riders can filter for women's, free, pads, attendant or accessible, and get a safe route to any of them. See `src/stops/washrooms.ts`.

**Musafira Safe Stops** let a shop owner list their place for riders: washroom counts, who can use it, period care, safety and rider features, and the Safe Stop Promise. To go live they prove they own a GoDaddy domain by adding a TXT record (`_musafira` → `musafira-verify=<code>`); Musafira reads it from DNS and checks through RDAP that GoDaddy is the registrar. Musafira suggests domain names and links to GoDaddy to buy them; it never buys a domain for anyone. Listed stops count as safety stops on route scores, appear first in washrooms near me, and get a public page at `/s/<id>`. Changing the domain takes a stop back to draft until it is verified again. See `src/planner/safeStops.ts`.

Planning has two stages. `POST /api/plan` fetches the routes and measures every segment at its arrival time; the result is cached under a `searchId` for 30 minutes. `POST /api/plan/:searchId/score` re-weights that cached analysis in tens of milliseconds, which is why the sliders feel live. The formula lives in `src/safety/scoring.ts`.

| Concern | Where | Notes |
| --- | --- | --- |
| Scoring engine | `src/safety/` | Pure and deterministic; one feature extractor per parameter |
| Planner | `src/planner/` | Ports for routing/traffic/geocoding, caching, ranking |
| City data | `src/city/`, `data/cities/` | Spatial index, opening hours in city time |
| Inbound auth (who is calling us?) | `src/auth/` | Verifies Firebase ID tokens; `requireAuth`, `requireVerifiedEmail`, `requireClaim` guards |
| Trip plans | `src/itinerary/`, `src/planner/itineraryPlanner.ts` | Candidates, Claude line format, schedule, fallback |
| Ride booking | `src/rides/`, `src/planner/rideBooking.ts` | Checkpoints, route guard, live and demo rides |
| Safe Stops and washrooms | `src/stops/`, `src/planner/safeStops.ts` | Questionnaire, domain proof, washroom ranking |
| Outbound clients | `src/integrations/` | Valhalla, TomTom, openrouteservice, GoDaddy, Anthropic, Namma Yatri, RDAP, DNS |
| Config | `src/config/env.ts` | Zod-validated env, fails fast |
| Routes | `src/routes/` | `/api/config`, `/api/plan`, `/api/itinerary`, `/api/places/*`, `/api/rides/*`, `/api/washrooms`, `/api/stops/:id`; `/api/me/preferences`, `/api/reports` and owner `/api/stops/*` (protected), `/healthz` |
| Web app | `web/` | Map scene in `web/src/map/`, state hooks in `web/src/state/` |

## Run it locally

```bash
npm ci && npm ci --prefix web
cp .env.example .env               # ORS_API_KEY adds address search and pin names; TOMTOM_API_KEY live traffic
cp web/.env.example web/.env       # optional: Firebase web config for sign-in
npm run dev                        # API on http://localhost:3000
npm run web:dev                    # app on http://localhost:5173
```

Guests don't need an account: weights are kept in the browser. Signing in only syncs them to Firestore.

To refresh a city's data, run `npm run ingest -- pune` (or `bengaluru`). This needs `OPENCELLID_API_KEY` and `NASA_EARTHDATA_TOKEN`. Raw downloads are cached in `data/raw/`.

### Data sources

© OpenStreetMap contributors (ODbL) · NASA Black Marble VNP46A4 (public domain) · OpenCelliD (CC BY-SA 4.0) · OpenFreeMap tiles · Valhalla · TomTom Traffic Flow · openrouteservice.

**Security rules of thumb**
- The GoDaddy key/secret and Firebase service account live only on the server (`.env`, never committed, never in a browser bundle).
- Use `GODADDY_ENV=ote` (sandbox) until you deliberately need production.
- GoDaddy keys have no scopes: a production key can do anything on the account. Revoke it when you are done.

## Checks

```bash
npm run typecheck && npm test
npm run web:typecheck
npm run smoke:godaddy    # verifies the GoDaddy key for GODADDY_ENV
npm run smoke:nammayatri -- <code>   # signs in with a fresh Namma Yatri code and fetches fares; never books
```

### GoDaddy
1. Sign in at https://developer.godaddy.com and create an OTE key and a production key.
2. Put each key/secret pair in `.env` (`GODADDY_OTE_API_*`, `GODADDY_PRODUCTION_API_*`).
3. Set `GODADDY_ENV` to `ote` or `production`, then run `npm run smoke:godaddy`.

### Firebase (free Spark plan)
1. https://console.firebase.google.com → create project → stay on **Spark**.
2. Build → Authentication → enable Email/Password (and Google).
3. Build → Firestore Database → create (production mode, pick a region near you).
4. Project settings → Service accounts → *Generate new private key* → paste the JSON as one line into
   `FIREBASE_SERVICE_ACCOUNT_JSON` (or base64-encode it). Delete the downloaded file afterwards.
5. Set `FIREBASE_PROJECT_ID`.

### Note on npm registries
`package-lock.json` points at `registry.npmjs.org`. If your machine is configured with a corporate mirror, npm
still resolves through the mirror. `overrides.protobufjs` is pinned to a version that resolves on such mirrors;
remove the pin when you can install the latest.
