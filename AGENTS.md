# Project guide

Node.js + TypeScript API (Fastify) for the GoDaddy Inclusive Innovation Hackathon 2026. Firebase Auth verifies users, Firestore stores data, and GoDaddy APIs are called server-side.

## Workflow rules (always follow)

- Never run `git commit`, `git push`, or any command that changes git history or remotes. Leave changes uncommitted for the user to review.
- Do not add comments. Make names and structure carry the meaning. Only comment a non-obvious *why* (a workaround, a constraint, a security reason), and keep it to one line.
- Prefer the simplest solution that works (KISS). No speculative features, abstractions, or config for needs that don't exist yet.
- Don't create docs or files that weren't asked for.

## Commands

- `npm run typecheck` - TypeScript check
- `npm test` - Vitest suite
- `npm run dev` - start the API with reload
- `npm run smoke:godaddy` - read-only check of the GoDaddy key for `GODADDY_ENV`

Run `npm run typecheck && npm test` after every code change and fix failures before finishing.

## Structure

- `src/config/` - validated env (`loadEnv`); the only place that reads `process.env`
- `src/auth/` - inbound auth: Firebase token verification and route guards
- `src/integrations/<vendor>/` - outbound API clients, one folder per vendor
- `src/routes/` - HTTP handlers; thin, delegate to services or clients
- `src/db/` - Firestore access
- `src/lib/` - small shared helpers (errors)
- `test/` - tests mirror the behaviour under test, not the file layout

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
- ESM with `.js` extensions in relative imports.
- Prefer small pure functions and `readonly`/`const`. Avoid classes unless they hold state or implement an interface.

## Security

- Secrets (GoDaddy key/secret, Firebase service account) live only in `.env`, never in code, logs, tests, or commits. Add new variables to `.env.example` with blank values.
- Never log tokens or `Authorization` headers.
- Protected routes must use `requireAuth`; add `requireVerifiedEmail` or `requireClaim` when the action needs it.
- Default `GODADDY_ENV` to the sandbox for anything that writes or costs money.

## Testing

- Add or update a test for every behaviour change. Test outcomes (status codes, returned data), not implementation details.
- Use `app.inject` for routes and injected fakes for external services. Tests must not call the network.

## Dependencies

- This machine installs through a corporate npm mirror. Keep `package-lock.json` pointing at `registry.npmjs.org`; never commit internal registry URLs.
- Add a dependency only when writing it ourselves would be clearly worse. Prefer what is already installed.
