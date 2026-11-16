import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const verifier = { verify: async () => Promise.reject(new Error("no auth in this test")) };

function builtWebApp(): string {
  const root = mkdtempSync(join(tmpdir(), "musafira-web-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Musafira</title>");
  writeFileSync(join(root, "assets", "index-abc123.js"), "console.log('app')");
  return root;
}

describe("hosted web app", () => {
  it("serves the page uncached and hashed assets cached for good", async () => {
    const app = await buildApp({ env, verifier, webRoot: builtWebApp() });

    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect(page.headers["content-security-policy"]).toContain("https://tiles.openfreemap.org");
    expect(page.headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");

    const asset = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
  });

  it("answers client-side paths with the page but keeps unknown API paths as JSON 404s", async () => {
    const app = await buildApp({ env, verifier, webRoot: builtWebApp() });

    const deepLink = await app.inject({ method: "GET", url: "/trip/somewhere" });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toContain("<title>Musafira</title>");

    const api = await app.inject({ method: "GET", url: "/api/nope" });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("NOT_FOUND");
    expect((await app.inject({ method: "POST", url: "/somewhere" })).statusCode).toBe(404);
  });

  it("still serves the API routes", async () => {
    const app = await buildApp({ env, verifier, webRoot: builtWebApp() });
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });
});
