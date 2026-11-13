import { getAuth } from "firebase-admin/auth";
import type { App } from "firebase-admin/app";
import { unauthorized } from "../lib/errors.js";

/** The identity we expose to the rest of the app - decoupled from Firebase's types. */
export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  /** Custom claims, e.g. { admin: true }. */
  claims: Record<string, unknown>;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<AuthUser>;
}

export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(
    private readonly app: App,
    /** Also checks the revocation list (one extra network call). Enable for sensitive routes. */
    private readonly checkRevoked = false,
  ) {}

  async verify(idToken: string): Promise<AuthUser> {
    try {
      const d = await getAuth(this.app).verifyIdToken(idToken, this.checkRevoked);
      const { uid, email, email_verified, iss, aud, auth_time, iat, exp, sub, firebase, ...claims } = d;
      void [iss, aud, auth_time, iat, exp, sub, firebase];
      return { uid, email, emailVerified: Boolean(email_verified), claims };
    } catch {
      // Don't leak why (expired vs. malformed vs. revoked) to the caller.
      throw unauthorized("Invalid or expired token");
    }
  }
}
