import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthorized } from "#src/lib/errors.js";
import type { AuthUser, TokenVerifier } from "#src/auth/tokenVerifier.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

/** Builds a Fastify preHandler that requires a valid Firebase ID token in `Authorization: Bearer`. */
export function createAuthGuard(verifier: TokenVerifier) {
  return async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const match = BEARER.exec(req.headers.authorization ?? "");
    if (!match?.[1]) throw unauthorized("Missing bearer token");
    req.user = await verifier.verify(match[1]);
  };
}

/** Use after requireAuth: `preHandler: [requireAuth, requireVerifiedEmail]`. */
export async function requireVerifiedEmail(req: FastifyRequest): Promise<void> {
  if (!req.user) throw unauthorized();
  if (!req.user.emailVerified) throw forbidden("Email not verified");
}

/** Authorise by custom claim, e.g. requireClaim("admin"). Set claims with the Admin SDK. */
export function requireClaim(claim: string) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.user) throw unauthorized();
    if (req.user.claims[claim] !== true) throw forbidden();
  };
}
