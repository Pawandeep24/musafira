/**
 * Sessions map a random handle to the Namma Yatri token in memory only (12 h); the token never
 * reaches the browser or the logs.
 */
import { randomBytes } from "node:crypto";
import { AppError } from "#src/lib/errors.js";
import { TtlCache } from "#src/lib/ttlCache.js";

const SESSION_TTL_MS = 12 * 60 * 60_000;

export const notLinked = () => new AppError(401, "NY_SIGNED_OUT", "Link your Namma Yatri account to book a live ride.");

export interface RideSessions {
  open(token: string): string;
  isLinked(session: string | undefined): boolean;
  close(session: string | undefined): void;
  signedIn<T>(session: string, call: (token: string) => Promise<T>): Promise<T>;
}

export function createRideSessions(): RideSessions {
  const tokens = new TtlCache<string, string>(SESSION_TTL_MS, 1000);

  return {
    open(token) {
      const session = randomBytes(24).toString("base64url");
      tokens.set(session, token);
      return session;
    },

    isLinked: (session) => Boolean(session && tokens.get(session)),

    close(session) {
      if (session) tokens.delete(session);
    },

    async signedIn<T>(session: string, call: (token: string) => Promise<T>): Promise<T> {
      try {
        const token = tokens.get(session);
        if (!token) throw notLinked();
        return await call(token);
      } catch (error) {
        if (error instanceof AppError && error.code === "NY_SIGNED_OUT") tokens.delete(session);
        throw error;
      }
    },
  };
}
