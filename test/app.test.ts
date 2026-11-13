import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth/tokenVerifier.js";
import { loadEnv } from "../src/config/env.js";
import { GoDaddyApiError, type GoDaddyClient } from "../src/integrations/godaddy/client.js";
import { unauthorized } from "../src/lib/errors.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t !== "good-token") throw unauthorized("Invalid or expired token");
    return { uid: "u1", email: "a@b.com", emailVerified: true, claims: {} };
  },
};

describe("loadEnv", () => {
  it("treats blank values (KEY=) as unset", () => {
    const e = loadEnv({ GODADDY_OTE_API_KEY: "", FIREBASE_PROJECT_ID: "  ", PORT: "4000" });
    expect(e.GODADDY_OTE_API_KEY).toBeUndefined();
    expect(e.FIREBASE_PROJECT_ID).toBeUndefined();
    expect(e.PORT).toBe(4000);
  });
});

describe("auth guard + routes", () => {
  it("healthz is public", async () => {
    const app = await buildApp({ env, verifier });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects missing and invalid tokens with 401", async () => {
    const app = await buildApp({ env, verifier });
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    const bad = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer nope" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe("UNAUTHORIZED");
  });

  it("returns the user for a valid token", async () => {
    const app = await buildApp({ env, verifier });
    const res = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer good-token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ uid: "u1", email: "a@b.com", emailVerified: true });
  });

  const auth = { authorization: "Bearer good-token" };

  it("validates the domain query", async () => {
    const godaddy = { request: vi.fn() } as unknown as GoDaddyClient;
    const app = await buildApp({ env, verifier, godaddy });
    const res = await app.inject({ method: "GET", url: "/api/domains/availability?domain=not_a_domain", headers: auth });
    expect(res.statusCode).toBe(400);
  });

  it("proxies availability via the GoDaddy client", async () => {
    const request = vi.fn(async () => ({ available: true, domain: "example.com" }));
    const app = await buildApp({ env, verifier, godaddy: { request } as unknown as GoDaddyClient });
    const res = await app.inject({ method: "GET", url: "/api/domains/availability?domain=Example.com", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith("/v1/domains/available", { query: { domain: "example.com" } });
  });

  it("maps upstream GoDaddy auth failures to 502, not 401", async () => {
    const request = vi.fn(async () => {
      throw new GoDaddyApiError(401, "UNABLE_TO_AUTHENTICATE", "bad token");
    });
    const app = await buildApp({ env, verifier, godaddy: { request } as unknown as GoDaddyClient });
    const res = await app.inject({ method: "GET", url: "/api/domains/availability?domain=example.com", headers: auth });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain("bad token");
  });

  it("503s when GoDaddy is not configured", async () => {
    const app = await buildApp({ env, verifier });
    const res = await app.inject({ method: "GET", url: "/api/domains/availability?domain=example.com", headers: auth });
    expect(res.statusCode).toBe(503);
  });
});
