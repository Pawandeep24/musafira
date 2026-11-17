/**
 * Sends contact mail through GoDaddy Node.js Hosting's email gateway. The platform only lets apps
 * connect out on HTTP and HTTPS, so SMTP never leaves the container (contract rules C11 and C13);
 * the gateway listening on loopback in every hosting container is the way mail goes out there.
 * It picks the sender from the app's attached domain, so `from` is left out; the site's mailbox is
 * the recipient and the visitor goes in Reply-To. A plain fetch, not `fetchJson`, because a refused
 * connection means "not on GoDaddy hosting" (a laptop) and hands the message to `fallback` (SMTP);
 * any other failure is an `UpstreamError("Email")` with only the HTTP status, never the gateway's
 * message, which can list the app's verified domains.
 */
import { z } from "zod";
import { UpstreamError } from "#src/lib/http.js";
import type { Mailer } from "#src/planner/ports.js";

const GATEWAY_URL = "http://127.0.0.1:2525/api/email/send";
const TIMEOUT_MS = 30_000;
const replySchema = z.object({ success: z.literal(true) });

const connectionRefused = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED";

export function createEmailGatewayMailer(fallback: Mailer, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    address: fallback.address,
    async send(mail) {
      let response: Response;
      try {
        response = await fetchImpl(GATEWAY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: [fallback.address], replyTo: mail.replyTo.address, subject: mail.subject, text: mail.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (connectionRefused(err)) return fallback.send(mail);
        throw new UpstreamError("Email");
      }
      const reply = replySchema.safeParse(await response.json().catch(() => undefined));
      if (!response.ok || !reply.success) throw new UpstreamError("Email", response.status);
    },
  };
}
