import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import type { Env } from "#src/config/env.js";

function parseServiceAccount(raw: string): Record<string, unknown> {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON)");
  }
}

/** Initialise the Firebase Admin app once. Works with a service account OR the local emulators. */
export function getFirebaseApp(env: Env): App {
  const existing = getApps()[0];
  if (existing) return existing;

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return initializeApp({
      credential: cert(sa as Parameters<typeof cert>[0]),
      projectId: env.FIREBASE_PROJECT_ID ?? (sa.project_id as string | undefined),
    });
  }

  if (!env.FIREBASE_PROJECT_ID) {
    throw new Error("Set FIREBASE_PROJECT_ID (and FIREBASE_SERVICE_ACCOUNT_JSON, or use the emulators)");
  }
  // No credential: fine for emulators; on GCP it falls back to Application Default Credentials.
  return initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
}
