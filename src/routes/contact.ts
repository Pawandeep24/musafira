import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "#src/lib/errors.js";
import type { Mailer } from "#src/planner/ports.js";

const singleLine = /^[^\r\n]*$/;

const contactBody = z
  .object({
    name: z.string().trim().min(1).max(80).regex(singleLine),
    email: z.email().max(254),
    message: z.string().trim().min(1).max(2000),
    website: z.string().max(200).optional(),
  })
  .strict();

/** Public. `website` is a field people never see: a bot that fills it gets the same reply, but nothing is sent. */
export const contactRoutes =
  ({ mailer }: { mailer?: Mailer }): FastifyPluginAsync =>
  async (app) => {
    app.post("/contact", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
      if (!mailer) throw new AppError(503, "NOT_CONFIGURED", "The contact form is not set up yet");
      const { name, email, message, website } = contactBody.parse(req.body);
      if (!website) {
        await mailer.send({ replyTo: { name, address: email }, subject: `Contact form: ${name}`, text: `${message}\n\n${name} <${email}>` });
      }
      return reply.status(202).send({ sent: true });
    });
  };
