# godaddy-hackathon

GoDaddy Inclusive Innovation Hackathon 2026 – project foundation (TypeScript / Fastify / Firebase).

## Architecture

```
Client ──(Firebase ID token)──▶ Our API ──(GoDaddy key+secret, server-side only)──▶ GoDaddy APIs
                                  │
                                  └──▶ Firestore (via Admin SDK)
```

| Concern | Where | Notes |
| --- | --- | --- |
| Inbound auth (who is calling us?) | `src/auth/` | Verifies Firebase ID tokens; `requireAuth`, `requireVerifiedEmail`, `requireClaim` guards |
| Outbound auth (us calling GoDaddy) | `src/integrations/godaddy/` | `TokenProvider` abstraction + `GoDaddyClient` (timeout, retry w/ backoff, `Retry-After`, idempotency keys, token redaction) |
| Config | `src/config/env.ts` | Zod-validated env, fails fast |
| Routes | `src/routes/` | `/healthz` (public), `/api/me`, `/api/domains/availability` (protected) |

**Security rules of thumb**
- The GoDaddy key/secret and Firebase service account live only on the server (`.env`, never committed, never in a browser bundle).
- Use `GODADDY_ENV=ote` (sandbox) until you deliberately need production.
- GoDaddy keys have no scopes: a production key can do anything on the account. Revoke it when you are done.

## Setup

```bash
npm ci
cp .env.example .env     # then fill in values
npm run typecheck && npm test
npm run smoke:godaddy    # verifies the GoDaddy key for GODADDY_ENV
npm run dev              # http://localhost:3000/healthz
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
