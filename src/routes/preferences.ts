import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { AppError } from "../lib/errors.js";
import { preferencesSchema, type PreferencesStore } from "../db/preferencesStore.js";

interface Deps {
  requireAuth: preHandlerAsyncHookHandler;
  store?: PreferencesStore;
}

/** Signed-in riders keep their weights across devices; guests keep them in the browser. */
export const preferencesRoutes =
  ({ requireAuth, store }: Deps): FastifyPluginAsync =>
  async (app) => {
    const requireStore = () => {
      if (!store) throw new AppError(503, "NOT_CONFIGURED", "Preferences storage is not configured");
      return store;
    };

    app.get("/me/preferences", { preHandler: requireAuth }, async (req) => ({
      preferences: (await requireStore().get(req.user!.uid)) ?? null,
    }));

    app.put("/me/preferences", { preHandler: requireAuth }, async (req) => {
      const preferences = preferencesSchema.parse(req.body);
      await requireStore().save(req.user!.uid, preferences);
      return { preferences };
    });
  };
