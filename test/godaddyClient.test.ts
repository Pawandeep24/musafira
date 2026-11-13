import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { GoDaddyApiError, GoDaddyClient } from "../src/integrations/godaddy/client.js";
import { StaticTokenProvider } from "../src/integrations/godaddy/tokenProvider.js";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

function make(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof GoDaddyClient>[0]> = {}) {
  const sleep = vi.fn(async () => {});
  const client = new GoDaddyClient({
    tokenProvider: new StaticTokenProvider("secret-pat"),
    baseUrl: "https://api.test",
    fetchImpl,
    sleep,
    ...extra,
  });
  return { client, sleep };
}

describe("GoDaddyClient", () => {
  it("sends the bearer token and query params", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const { client } = make(fetchImpl as unknown as typeof fetch);
    await client.request("/v3/x", { query: { domain: "a.com", skip: undefined } });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v3/x?domain=a.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-pat");
  });

  it("retries GET on 503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const { client, sleep } = make(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x")).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("honours Retry-After on 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(json({}));
    const { client, sleep } = make(fetchImpl as unknown as typeof fetch);
    await client.request("/x");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("does NOT retry POST without an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const { client } = make(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x", { method: "POST", body: {} })).rejects.toBeInstanceOf(GoDaddyApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries POST when an idempotency key is supplied", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json({ id: 1 }));
    const { client } = make(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x", { method: "POST", body: {}, idempotencyKey: "k1" })).resolves.toEqual({ id: 1 });
  });

  it("maps error bodies and never leaks the token", async () => {
    const fetchImpl = vi.fn(async () => json({ code: "UNABLE_TO_AUTHENTICATE", message: "bad scope" }, { status: 403 }));
    const { client } = make(fetchImpl as unknown as typeof fetch);
    const err = (await client.request("/x").catch((e) => e)) as GoDaddyApiError;
    expect(err).toBeInstanceOf(GoDaddyApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("UNABLE_TO_AUTHENTICATE");
    expect(JSON.stringify(err) + err.message + err.stack).not.toContain("secret-pat");
  });

  it("gives up after maxAttempts", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    const { client } = make(fetchImpl as unknown as typeof fetch, { maxAttempts: 3 });
    await expect(client.request("/x")).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("StaticTokenProvider", () => {
  it("redacts the token when logged", () => {
    const p = new StaticTokenProvider("secret-pat");
    expect(JSON.stringify(p)).not.toContain("secret-pat");
    expect(inspect(p)).not.toContain("secret-pat");
  });
});
