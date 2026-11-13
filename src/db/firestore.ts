import type { App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export function getDb(app: App): Firestore {
  const db = getFirestore(app);
  // Treat `undefined` fields as "skip" instead of throwing.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may only be called once; ignore if already configured.
  }
  return db;
}
