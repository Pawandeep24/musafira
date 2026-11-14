import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { optionsSchema, weightsSchema, type ScoringOptions, type Weights } from "../safety/parameters.js";

export interface Preferences {
  readonly weights: Weights;
  readonly options: ScoringOptions;
  readonly presetId?: string;
}

export interface PreferencesStore {
  get(uid: string): Promise<Preferences | undefined>;
  save(uid: string, preferences: Preferences): Promise<void>;
}

export const preferencesSchema = z.object({
  weights: weightsSchema,
  options: optionsSchema,
  presetId: z.string().max(40).optional(),
});

export function createFirestorePreferencesStore(db: Firestore): PreferencesStore {
  const doc = (uid: string) => db.collection("users").doc(uid);
  return {
    async get(uid) {
      const snapshot = await doc(uid).get();
      const parsed = preferencesSchema.safeParse(snapshot.get("preferences"));
      return parsed.success ? parsed.data : undefined;
    },
    async save(uid, preferences) {
      await doc(uid).set({ preferences, preferencesUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
  };
}
