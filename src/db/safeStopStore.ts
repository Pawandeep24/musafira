import { Timestamp, type Firestore, type Query } from "firebase-admin/firestore";
import { z } from "zod";
import { safeStopProfileSchema, type SafeStop } from "#src/stops/safeStop.js";

export interface SafeStopStore {
  get(id: string): Promise<SafeStop | undefined>;
  byOwner(uid: string): Promise<SafeStop[]>;
  listed(): Promise<SafeStop[]>;
  save(stop: SafeStop): Promise<void>;
}

const safeStopDocSchema = z.object({
  ownerUid: z.string(),
  cityId: z.string(),
  profile: safeStopProfileSchema,
  verifyCode: z.string(),
  status: z.enum(["draft", "listed"]),
  registrar: z.string().optional(),
  verifiedAt: z.instanceof(Timestamp).optional(),
  updatedAt: z.instanceof(Timestamp),
});

function fromDoc(id: string, data: unknown): SafeStop | undefined {
  const parsed = safeStopDocSchema.safeParse(data);
  if (!parsed.success) return undefined;
  const { verifiedAt, updatedAt, registrar, ...rest } = parsed.data;
  return {
    id,
    ...rest,
    ...(registrar ? { registrar } : {}),
    ...(verifiedAt ? { verifiedAt: verifiedAt.toDate() } : {}),
    updatedAt: updatedAt.toDate(),
  };
}

export function createFirestoreSafeStopStore(db: Firestore): SafeStopStore {
  const stops = db.collection("safeStops");
  const all = async (query: Query) => (await query.get()).docs.flatMap((doc) => fromDoc(doc.id, doc.data()) ?? []);
  return {
    async get(id) {
      const doc = await stops.doc(id).get();
      return doc.exists ? fromDoc(doc.id, doc.data()) : undefined;
    },
    byOwner: (uid) => all(stops.where("ownerUid", "==", uid)),
    listed: () => all(stops.where("status", "==", "listed")),
    async save({ id, profile, registrar, verifiedAt, updatedAt, ...rest }) {
      await stops.doc(id).set({
        ...rest,
        // Firestore rejects undefined fields; a JSON round trip drops the empty optional answers.
        profile: JSON.parse(JSON.stringify(profile)) as unknown,
        ...(registrar ? { registrar } : {}),
        ...(verifiedAt ? { verifiedAt: Timestamp.fromDate(verifiedAt) } : {}),
        updatedAt: Timestamp.fromDate(updatedAt),
      });
    },
  };
}
