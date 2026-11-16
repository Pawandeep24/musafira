import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "#src/config/env.js";
import { createGoDaddyClient } from "#src/integrations/godaddy/factory.js";

const credentials = {
  GODADDY_OTE_API_KEY: "ote-key",
  GODADDY_OTE_API_SECRET: "ote-secret",
  GODADDY_PRODUCTION_API_KEY: "prod-key",
  GODADDY_PRODUCTION_API_SECRET: "prod-secret",
};

async function authorizationHeaderFor(godaddyEnv: "ote" | "production") {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  const client = createGoDaddyClient(loadEnv({ ...credentials, GODADDY_ENV: godaddyEnv }));
  await client!.request("/v1/x");
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  fetchSpy.mockRestore();
  return { url, authorization: (init.headers as Record<string, string>).Authorization };
}

describe("createGoDaddyClient", () => {
  it("uses the OTE key and host when GODADDY_ENV=ote", async () => {
    const { url, authorization } = await authorizationHeaderFor("ote");
    expect(url).toContain("api.ote-godaddy.com");
    expect(authorization).toBe("sso-key ote-key:ote-secret");
  });

  it("uses the production key and host when GODADDY_ENV=production", async () => {
    const { url, authorization } = await authorizationHeaderFor("production");
    expect(url).toContain("https://api.godaddy.com");
    expect(authorization).toBe("sso-key prod-key:prod-secret");
  });

  it("returns undefined when the selected environment has no credentials", () => {
    const env = loadEnv({ GODADDY_ENV: "production", GODADDY_OTE_API_KEY: "k", GODADDY_OTE_API_SECRET: "s" });
    expect(createGoDaddyClient(env)).toBeUndefined();
  });
});
