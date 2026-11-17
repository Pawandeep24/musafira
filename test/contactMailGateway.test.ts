import { describe, expect, it, vi } from "vitest";
import { createEmailGatewayMailer } from "#src/integrations/godaddy/emailGateway.js";
import { UpstreamError } from "#src/lib/http.js";
import type { SiteMail } from "#src/planner/ports.js";

const mail: SiteMail = {
  replyTo: { name: "Asha", address: "asha@example.com" },
  subject: "Contact form: Asha",
  text: "Can my tea stall become a Safe Stop?",
};
const smtp = () => ({ address: "support@musafira.app", send: vi.fn(async () => {}) });
const gatewayReply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

describe("contact mail on GoDaddy hosting", () => {
  it("goes through the hosting email gateway to the site's mailbox, with the visitor as reply address and no sender", async () => {
    const fallback = smtp();
    const fetchImpl = gatewayReply(200, { success: true, messageId: "m-1" });
    await createEmailGatewayMailer(fallback, fetchImpl).send(mail);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:2525/api/email/send");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ to: ["support@musafira.app"], replyTo: "asha@example.com", subject: mail.subject, text: mail.text });
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("falls back to SMTP where no gateway is listening, as on a laptop", async () => {
    const fallback = smtp();
    const fetchImpl = vi.fn(async () => {
      throw refused();
    });
    await createEmailGatewayMailer(fallback, fetchImpl).send(mail);
    expect(fallback.send).toHaveBeenCalledWith(mail);
  });

  it("reports a gateway rejection with only its status and does not retry over SMTP", async () => {
    const fallback = smtp();
    const fetchImpl = gatewayReply(400, { success: false, error: "from must be on musafira.app" });
    const failure = await createEmailGatewayMailer(fallback, fetchImpl)
      .send(mail)
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).status).toBe(400);
    expect((failure as Error).message).not.toContain("musafira.app");
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("fails without retrying over SMTP when the gateway times out", async () => {
    const fallback = smtp();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(createEmailGatewayMailer(fallback, fetchImpl).send(mail)).rejects.toBeInstanceOf(UpstreamError);
    expect(fallback.send).not.toHaveBeenCalled();
  });
});
