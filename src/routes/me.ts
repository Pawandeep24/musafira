import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { preferencesSchema, type PreferencesStore } from "../db/preferencesStore.js";
import { AppError } from "../lib/errors.js";

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  db?: Firestore;
  preferences?: PreferencesStore;
}

/**
 * The signed-in rider's own resources. `/me` returns her and upserts a profile doc, which proves
 * Auth + Firestore are wired. `/me/preferences` keeps her weights across devices; guests keep them
 * in the browser.
 */
export const meRoutes =
  ({ requireAuth, db, preferences: store }: Deps): FastifyPluginAsync =>
  async (app) => {
    const requireStore = () => {
      if (!store) throw new AppError(503, "NOT_CONFIGURED", "Preferences storage is not configured");
      return store;
    };

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

    app.get("/me/preferences", { preHandler: requireAuth }, async (req) => ({
      preferences: (await requireStore().get(req.user!.uid)) ?? null,
    }));

    app.put("/me/preferences", { preHandler: requireAuth }, async (req) => {
      const preferences = preferencesSchema.parse(req.body);
      await requireStore().save(req.user!.uid, preferences);
      return { preferences };
    });
  };
