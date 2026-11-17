import { describe, expect, it, vi } from "vitest";
import { buildApp } from "#src/app.js";
import type { TokenVerifier } from "#src/auth/tokenVerifier.js";
import { loadEnv } from "#src/config/env.js";
import { unauthorized } from "#src/lib/errors.js";
import { UpstreamError } from "#src/lib/http.js";
import type { Mailer } from "#src/planner/ports.js";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const verifier: TokenVerifier = {
  verify: async () => {
    throw unauthorized("Invalid or expired token");
  },
};
const message = { name: "Asha", email: "asha@example.com", message: "Can my tea stall become a Safe Stop?" };

const fakeMailer = (send: Mailer["send"] = async () => {}) => ({ address: "support@musafira.app", send: vi.fn(send) });
const post = (app: Awaited<ReturnType<typeof buildApp>>, payload: unknown) => app.inject({ method: "POST", url: "/api/contact", payload: payload as object });

describe("contact form", () => {
  it("delivers the message to the site's mailbox with the visitor as the reply address", async () => {
    const mailer = fakeMailer();
    const app = await buildApp({ env, verifier, mailer });
    const res = await post(app, message);
    expect(res.statusCode).toBe(202);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mail = mailer.send.mock.calls[0]![0];
    expect(mail.replyTo).toEqual({ name: "Asha", address: "asha@example.com" });
    expect(mail.text).toContain("Can my tea stall become a Safe Stop?");
  });

  it("shows the contact address in the config only when mail can be sent", async () => {
    const withMail = await buildApp({ env, verifier, mailer: fakeMailer() });
    expect((await withMail.inject({ method: "GET", url: "/api/config" })).json().contactEmail).toBe("support@musafira.app");
    const without = await buildApp({ env, verifier });
    expect((await without.inject({ method: "GET", url: "/api/config" })).json().contactEmail).toBeUndefined();
  });

  it("rejects a bad email, an empty message and a multi-line name without sending", async () => {
    const mailer = fakeMailer();
    const app = await buildApp({ env, verifier, mailer });
    expect((await post(app, { ...message, email: "not-an-email" })).statusCode).toBe(400);
    expect((await post(app, { ...message, message: "   " })).statusCode).toBe(400);
    expect((await post(app, { ...message, name: "Asha\nBcc: everyone@example.com" })).statusCode).toBe(400);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("answers a bot that fills the hidden field like anyone else, but sends nothing", async () => {
    const mailer = fakeMailer();
    const app = await buildApp({ env, verifier, mailer });
    const res = await post(app, { ...message, website: "https://spam.example" });
    expect(res.statusCode).toBe(202);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("returns 503 when mail is not set up", async () => {
    const app = await buildApp({ env, verifier });
    expect((await post(app, message)).statusCode).toBe(503);
  });

  it("allows three messages an hour from one visitor", async () => {
    const app = await buildApp({ env, verifier, mailer: fakeMailer() });
    for (let i = 0; i < 3; i++) expect((await post(app, message)).statusCode).toBe(202);
    expect((await post(app, message)).statusCode).toBe(429);
  });

  it("reports a mail server failure as 502 without its details", async () => {
    const app = await buildApp({
      env,
      verifier,
      mailer: fakeMailer(async () => {
        throw new UpstreamError("Email", 535);
      }),
    });
    const res = await post(app, message);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain("535");
  });
});
