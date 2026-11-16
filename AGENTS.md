# Project guide

**Musafira** – safer two-wheeler routes for the hour you ride, built for the GoDaddy Inclusive Innovation Hackathon 2026. A Node.js + TypeScript API (Fastify) scores alternative routes for lighting, safety stops, people around, signal and more at the rider's actual arrival time; a React + MapLibre + deck.gl web app (`web/`) presents them. Firebase Auth verifies optional sign-in, Firestore stores preferences, rider reports and Safe Stop listings (shops verified through their GoDaddy domain).

## Workflow rules (always follow)

- Never run `git commit`, `git push`, or any command that changes git history or remotes. Leave changes uncommitted for the user to review.
- No line-by-line comments. Make names and structure carry the meaning. Only comment a non-obvious *why* (a workaround, a constraint, a security reason), and keep it to one line.
- Files with non-obvious logic (a formula, a tuning constant, time-zone handling, an external data format, an animation or camera model) start with a short `/** ... */` doc header: what the module does, the formula or contract, and why it works that way. Update the header when the logic changes. Plain files get no header.
- Prefer the simplest solution that works (KISS). No speculative features, abstractions, or config for needs that don't exist yet.
- Don't create docs or files that weren't asked for.

## Commands

- `npm run typecheck` - TypeScript check (API, scripts, tests)
- `npm test` - Vitest suite
- `npm run dev` - start the API with reload on http://localhost:3000
- `npm run ingest -- <cityId>` - rebuild `data/cities/<cityId>.json` (OSM POIs, named places and public toilets, NASA night lights, OpenCelliD); needs keys in `.env`
- `npm run smoke:godaddy` - read-only check of the GoDaddy key for `GODADDY_ENV`
- `npm run smoke:nammayatri -- <code>` - read-only Namma Yatri check with a fresh 2-minute code: sign-in, fares direct and via a stop; never books
- `npm run web:dev` - start the web app on http://localhost:5173 (proxies `/api` to the API)
- `npm run web:typecheck` / `npm run web:build` - check or build the web app

Run `npm run typecheck && npm test` after every API change, and `npm run web:typecheck` after every web change. Fix failures before finishing.

## Structure

- `src/config/` - validated env (`loadEnv`); the only place that reads `process.env`
- `src/auth/` - inbound auth: Firebase token verification and route guards
- `src/geo/` - pure geometry: distances, polylines, measured paths
- `src/city/` - city data model (zod), spatial index, opening hours, registry loaded from `data/cities/`
- `src/safety/` - the pure scoring engine: segmentation, one extractor per parameter in `features/`, stops, stretches, scoring
- `src/itinerary/` - the pure trip-plan engine: candidate places, Claude prompt and reply parser, basic plan, schedule in city time
- `src/rides/` - the pure ride engine: safety checkpoints, route guard, demo meter fares and simulated driver
- `src/stops/` - Safe Stop questionnaire and domain proof, washroom ranking for "washrooms near me"
- `src/planner/` - application services: ports (`RouteProvider`, `TrafficProvider`, `Geocoder`, `TextModel`, `CarRouter`, `RideHailing`, `SafeStopSource`, `DomainLookup`) plus caching and ranking around the engines
- `src/integrations/<vendor>/` - outbound API clients, one folder per vendor (`valhalla`, `tomtom`, `ors`, `godaddy`, `anthropic`, `nammayatri`, `rdap`, `dns`); JSON calls go through `fetchJson` in `src/lib/http.ts` (GoDaddy keeps its own for retries and token refresh)
- `src/routes/` - HTTP handlers, one file per resource with all its methods; thin, delegate to services or clients
- `src/db/` - Firestore access
- `src/lib/` - small shared helpers (errors, fetch with schema, TTL cache)
- `scripts/ingest/` - offline city ingest; raw downloads are cached in `data/raw/` (gitignored), output in `data/cities/` (committed)
- `test/` - tests mirror the behaviour under test, not the file layout
- `web/src/api/` - DTO types and the fetch client (mirror `src/routes/planResponse.ts`)
- `web/src/state/` - React hooks owning app state (planner, safety profile, ride preview clock and camera presets, ride booking, washrooms, Safe Stop onboarding, map theme, mobile sheet height)
- `web/src/StopPage.tsx` - the public Safe Stop page at `/s/<id>`, chosen in `main.tsx` instead of the map app
- `web/src/map/` - MapLibre style, deck.gl scene layers, data dot-matrices
- `web/src/components/` - presentational components, each with its own `.css` beside it; no fetching except place search
- `web/src/components/ui/` - shared controls (`Button`, `ButtonLink`, `IconButton`, `LinkButton`, `ToggleChip`, `Segmented`, `Notice`, `Eyebrow`, `SheetHeader`) and their styles in `controls.css`
- `web/src/styles/` - tokens, base, shared panels (`side-sheet.css`, `dialog.css`), motion and the responsive layer; `index.css` imports every stylesheet once in cascade order
- `web/src/lib/` - pure helpers (formatting in city time, colours, track maths, route verdict)

## Where the non-obvious logic lives

Read the doc header before changing these:

- `src/safety/scoring.ts` - score formula, penalties as a share of the base, confidence
- `src/safety/community.ts` - rider reports as evidence: decay, time-of-day match, distance falloff, blend into sensor values
- `src/planner/routePlanner.ts` - two-stage plan/rescore, caches, ranking and labels
- `src/planner/communityReports.ts` - anonymous report ids, per-rider limits, in-memory index of recent reports
- `src/city/openingHours.ts` - OSM hours vs category defaults, city wall-clock evaluation
- `src/city/placeSearch.ts` - type-ahead matching (prefix, sound-alike, typo), rank formula, duplicate merging
- `src/planner/placeSuggester.ts` - when the remote geocoder tops up local place results
- `src/itinerary/candidates.ts` - which real places are offered for a trip: diet and chain filters, duplicates, rank formula
- `src/itinerary/prompt.ts` - the compact line format sent to Claude and parsed back (refs only, so it can't invent places)
- `src/itinerary/fill.ts` - the basic plan and gap filling: anchor sight, nearest-first walk
- `src/itinerary/schedule.ts` - stay times, meal windows, opening-hours swaps, dusk limit and dark legs
- `src/planner/itineraryPlanner.ts` - plan cache, daily spend cap, fallback to the basic plan
- `src/integrations/anthropic/client.ts` - Haiku request shape and cost from token usage
- `scripts/ingest/osmPlaces.ts` - which OSM features become searchable places and how duplicates merge
- `src/integrations/valhalla/client.ts` - alternates, per-vertex ETA, road classes via `trace_attributes`, car routes through checkpoints
- `src/rides/checkpoints.ts` - where safety checkpoints go so a car route follows the safe route, and when none are needed
- `src/rides/guard.ts` - off-route rule (recent positions vs distance from the route) and progress
- `src/rides/demoRide.ts` - city auto tariffs with night rates, the simulated driver clock and detour
- `src/planner/rideBooking.ts` - Namma Yatri sessions, live vs demo quotes, booking match after a driver accepts, tracking, cancel stages
- `src/integrations/nammayatri/client.ts` - rider API: code sign-in, search with stops, estimate polling, bookings, ride status
- `src/stops/safeStop.ts` - questionnaire schema, TXT record at `_musafira.<domain>` plus GoDaddy registrar as proof of ownership
- `src/stops/washrooms.ts` - washroom candidates and the rank formula (ride minutes, unknown facts, Safe Stop bonus)
- `src/planner/safeStops.ts` - listings, in-memory index of listed stops, re-verification on domain change, limits, domain-idea availability
- `src/integrations/rdap/client.ts`, `src/integrations/dns/txt.ts` - registrar from RDAP; TXT asked of the zone's own nameservers first
- `scripts/ingest/osmWashrooms.ts` - which OSM toilet tags become washroom facts
- `scripts/ingest/nightLights.ts`, `scripts/ingest/cellTowers.ts` - source formats and grid construction
- `web/src/map/sceneLayers.ts` - layer stack and animation model
- `web/src/state/ridePreview.ts` - ride preview as a re-timeable clock: the same on-screen pace in every camera preset, pause and resume
- `web/src/map/MapView.tsx` - preview camera: follows the rider, eases to a preset, keeps the rider's own pinch or scroll zoom, lets go while paused and flies back on resume
- `web/src/state/useRideBooking.ts` - booking steps, session and ride kept in sessionStorage, polling and off-route alert
- `web/src/state/useSheet.ts` - mobile sheet detents, drag and flick snapping, drag height written to CSS outside React

## Frontend

- Components receive data and callbacks; state lives in `web/src/state/` hooks and `App.tsx` wires them together.
- Phones (760px and narrower) get their own layout, not a squeezed desktop: one draggable bottom sheet whose height (`--sheet-height`) drives every panel, the grip, the credits and the map padding; map tools on a right-edge rail; the trip folds into a summary once routes show. Keep tap targets at 40px or more, and leave desktop untouched by mobile changes.
- All times shown to riders are in the city's time zone (`utcOffsetMinutes`), never the browser's. Use `web/src/lib/format.ts`.
- Build buttons, chips, segmented controls, notices and panel headers from `web/src/components/ui/` rather than repeating their markup. When another control's markup repeats a third time, add it to `ui/` with its styles in `controls.css` and list it under Structure.
- A new component is two files side by side in `web/src/components/`: `Name.tsx` and `Name.css` (`RideHud.tsx`, `RideHud.css`). Register the stylesheet with one `@import` in `styles/index.css`, placed in cascade order before `responsive.css`, which stays last. Components never import CSS themselves; `main.tsx` loads `tokens.css`, then `styles/index.css`.
- Styles shared by several components go in `web/src/styles/`. Breakpoint overrides go in `responsive.css` and reduced-motion overrides in `motion.css`, never in a component's own file, so they come last in the cascade.
- Use BEM-like class names (`block__element`, `is-state`); no inline styles except values computed at runtime.
- The map opens on the night basemap and switches only when the rider uses the day/night toggle, never with the ride hour or the departure slider. Over the night basemap the deck.gl canvas is screen-blended, so light colours add glow; over the day basemap it blends normally, and scene colours go through `deepen` (`web/src/lib/colors.ts`) so pastels stay readable. Keep both basemaps low-contrast so safety colours carry the meaning, and keep their layer stacks identical so a switch is a paint-only diff.

## Design principles

Apply SOLID and common patterns where they remove real duplication or coupling, and stop there.

- **Single responsibility:** a module does one thing. Routes parse input and shape output; logic lives elsewhere.
- **Depend on interfaces, inject dependencies:** pass collaborators (`TokenVerifier`, `TokenProvider`, `GoDaddyClient`, `Firestore`) into `buildApp` or constructors. This is what keeps code testable without mocking modules.
- **Extract only on the third use.** Two similar blocks are fine; three justify a shared function.
- **No design pattern without a present need.** Don't add factories, registries, or layers "for later".
- Validate all external input (request params, env, upstream responses) at the boundary with zod. Inside the boundary, trust the types.
- Throw `AppError` for client-visible failures. Never leak upstream or internal error details to callers.

## TypeScript

- Strict mode is on. No `any`; use `unknown` and narrow.
- Import project files by their path from the source root, never with `./` or `../`. The API, tests and scripts use `#src/...`, `#test/...` and `#scripts/...` with a `.js` extension; the web app uses `@/...` without one, in CSS `@import`s too. Packages keep their bare names.
- The API's `#` paths come from `imports` in `package.json`. Tools that read the sources (`tsc`, Vitest, and the npm scripts, which run `tsx --conditions=musafira-source`) resolve `#src/*` to `src/`; plain `node dist/server.js` resolves it to `dist/`. Run one-off files with `tsx --conditions=musafira-source`, since a bare `tsx` loads `dist/`.
- No unused imports: `noUnusedLocals` is on in both tsconfigs, so the typecheck fails on one. Delete an import together with its last use.
- Prefer small pure functions and `readonly`/`const`. Avoid classes unless they hold state or implement an interface.

## Security

- Secrets (GoDaddy key/secret, Firebase service account) live only in `.env`, never in code, logs, tests, or commits. Add new variables to `.env.example` with blank values.
- Never log tokens or `Authorization` headers.
- Protected routes must use `requireAuth`; add `requireVerifiedEmail` or `requireClaim` when the action needs it.
- Default `GODADDY_ENV` to the sandbox for anything that writes or costs money.

## Testing

- Add or update a test for every behaviour change. Test outcomes (status codes, returned data), not implementation details.
- Use `app.inject` for routes and injected fakes for external services. Tests must not call the network.
- Safety engine tests build synthetic cities with `test/fixtures.ts`; assert relative outcomes (route A outranks route B), not exact scores.

## Dependencies

- This machine installs through a corporate npm mirror. Keep `package-lock.json` pointing at `registry.npmjs.org`; never commit internal registry URLs.
- Add a dependency only when writing it ourselves would be clearly worse. Prefer what is already installed.
