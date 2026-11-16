import { describe, expect, it, vi } from "vitest";
import { RdapClient } from "#src/integrations/rdap/client.js";
import { UpstreamError } from "#src/lib/http.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const registrarEntity = (name: string) => ({ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", name]]] });

function client(reply: () => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => reply());
  return { rdap: new RdapClient({ baseUrl: "https://rdap.test", fetchImpl }), fetchImpl };
}

describe("RDAP client", () => {
  it("names the registrar from its vCard and asks for RDAP JSON", async () => {
    const { rdap, fetchImpl } = client(() => json({ entities: [{ roles: ["registrant"] }, registrarEntity(" GoDaddy.com, LLC ")] }));
    await expect(rdap.registrar("sharma chai.in")).resolves.toBe("GoDaddy.com, LLC");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://rdap.test/domain/sharma%20chai.in");
    expect((init!.headers as Record<string, string>).Accept).toBe("application/rdap+json, application/json");
    expect(init!.method ?? "GET").toBe("GET");
  });

  it("reports a domain with no named registrar as unknown", async () => {
    const { rdap } = client(() => json({ entities: [{ roles: ["registrar"] }] }));
    await expect(rdap.registrar("example.in")).resolves.toBe("Unknown registrar");
  });

  it("treats 404 as not registered", async () => {
    const { rdap } = client(() => json({ errorCode: 404 }, 404));
    await expect(rdap.registrar("nobody-owns-this.in")).resolves.toBeUndefined();
  });

  it("fails generically on server errors, bad replies and network failures", async () => {
    const serverError = await client(() => json({ detail: "stack trace" }, 503)).rdap.registrar("a.in").catch((e: unknown) => e);
    expect(serverError).toBeInstanceOf(UpstreamError);
    expect(serverError).toMatchObject({ service: "Domain registry", status: 503 });
    expect((serverError as Error).message).not.toContain("stack trace");

    await expect(client(() => new Response("not json")).rdap.registrar("a.in")).rejects.toMatchObject({ service: "Domain registry", status: 200 });
    await expect(client(() => json({ entities: "nope" })).rdap.registrar("a.in")).rejects.toBeInstanceOf(UpstreamError);
    await expect(client(() => Promise.reject(new TypeError("fetch failed"))).rdap.registrar("a.in")).rejects.toMatchObject({ service: "Domain registry", status: undefined });
  });
});
