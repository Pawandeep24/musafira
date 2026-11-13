import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  db?: Firestore;
}

/** Returns the signed-in user and upserts a profile doc - proves Auth + Firestore are wired. */
export const meRoutes =
  ({ requireAuth, db }: Deps): FastifyPluginAsync =>
  async (app) => {
    app.get("/me", { preHandler: requireAuth }, async (req) => {
      const user = req.user!;
      if (db) {
        await db.collection("users").doc(user.uid).set(
          {
            email: user.email ?? null,
            lastSeenAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return { uid: user.uid, email: user.email ?? null, emailVerified: user.emailVerified };
    });
  };
