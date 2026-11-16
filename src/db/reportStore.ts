import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { REPORT_CATEGORIES, type CommunityReport } from "#src/safety/community.js";

export interface StoredReport extends CommunityReport {
  readonly cityId: string;
}

export interface ReportStore {
  save(report: StoredReport): Promise<void>;
  observedSince(since: Date): Promise<StoredReport[]>;
}

const reportDocSchema = z.object({
  cityId: z.string(),
  category: z.enum(REPORT_CATEGORIES),
  lon: z.number(),
  lat: z.number(),
  observedAt: z.instanceof(Timestamp),
});

export function createFirestoreReportStore(db: Firestore): ReportStore {
  const reports = db.collection("reports");
  return {
    async save({ id, cityId, category, point: [lon, lat], observedAt }) {
      await reports
        .doc(id)
        .set({ cityId, category, lon, lat, observedAt: Timestamp.fromDate(observedAt), createdAt: FieldValue.serverTimestamp() });
    },
    async observedSince(since) {
      const snapshot = await reports.where("observedAt", ">=", Timestamp.fromDate(since)).get();
      return snapshot.docs.flatMap((doc) => {
        const parsed = reportDocSchema.safeParse(doc.data());
        if (!parsed.success) return [];
        const { cityId, category, lon, lat, observedAt } = parsed.data;
        return [{ id: doc.id, cityId, category, point: [lon, lat] as const, observedAt: observedAt.toDate() }];
      });
    },
  };
}
