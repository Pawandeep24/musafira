/**
 * Sends mail through the site's own mailbox over SMTP, used off GoDaddy hosting (a laptop) where the
 * hosting email gateway isn't there. For a GoDaddy mailbox that is smtpout.secureserver.net with the
 * full address as the username. The mailbox is both sender and recipient, so the domain's SPF and
 * DKIM line up; the visitor only goes in Reply-To. Port 465 is implicit TLS; any other port
 * upgrades with STARTTLS. A failure surfaces as an `UpstreamError("Email")` carrying only the SMTP
 * reply code (535 means the mailbox password was rejected) and nodemailer's error code (`ETIMEDOUT`,
 * `ECONNECTION`, `EAUTH`...) for the logs, never the server's reply text.
 */
import { createTransport } from "nodemailer";
import { UpstreamError } from "#src/lib/http.js";
import type { Mailer } from "#src/planner/ports.js";

interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

const TIMEOUTS = { connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 30_000 };

class SmtpError extends UpstreamError {
  constructor(
    status: number | undefined,
    readonly code: string | undefined,
  ) {
    super("Email", status);
    this.name = "SmtpError";
  }
}

export function createSmtpMailer({ host, port, user, password }: SmtpOptions): Mailer {
  const transport = createTransport({ host, port, secure: port === 465, auth: { user, pass: password }, ...TIMEOUTS });
  return {
    address: user,
    async send({ replyTo, subject, text }) {
      try {
        await transport.sendMail({ from: { name: "Musafira contact form", address: user }, to: user, replyTo, subject, text });
      } catch (err) {
        const { responseCode, code } = err as { responseCode?: number; code?: string };
        throw new SmtpError(responseCode, code);
      }
    },
  };
}
