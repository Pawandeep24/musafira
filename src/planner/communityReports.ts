/**
 * Accepts rider reports and keeps each city's recent ones in memory for the planner.
 *
 * A stored report carries no reporter identity. Its id is
 *   sha256(uid | category | ~110 m cell | city-local date)
 * so a rider repeating the same report at the same spot on the same day overwrites it
 * instead of stacking evidence, while the uid itself is never written. Each rider may
 * send 5 reports an hour and 20 a day; the counters live in process memory, which is
 * enough for one instance. Reports older than 180 days are dropped: their evidence has
 * decayed to almost nothing by then.
 */
import { createHash } from "node:crypto";
import type { CityRegistry } from "#src/city/cityRegistry.js";
import type { ReportStore } from "#src/db/reportStore.js";
import type { LngLat } from "#src/geo/geometry.js";
import { AppError } from "#src/lib/errors.js";
import { TtlCache } from "#src/lib/ttlCache.js";
import { observedAtFor, spotOf, type CommunityReport, type ReportCategory, type ReportWhen } from "#src/safety/community.js";
import type { ReportSource } from "#src/planner/ports.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_AGE_MS = 180 * DAY_MS;
const PER_HOUR = 5;
const PER_DAY = 20;

export interface ReportInput {
  readonly point: LngLat;
  readonly category: ReportCategory;
  readonly when: ReportWhen;
}

export interface CommunityReports extends ReportSource {
  load(): Promise<number>;
  submit(uid: string, input: ReportInput): Promise<CommunityReport>;
}

export interface CommunityReportsDeps {
  readonly store: ReportStore;
  readonly cities: CityRegistry;
  readonly now?: () => Date;
}

export function createCommunityReports({ store, cities, now = () => new Date() }: CommunityReportsDeps): CommunityReports {
  const byCity = new Map<string, Map<string, CommunityReport>>();
  const sentAt = new TtlCache<string, number[]>(DAY_MS, 10_000, () => now().getTime());

  const remember = (cityId: string, report: CommunityReport) => {
    const reports = byCity.get(cityId) ?? new Map<string, CommunityReport>();
    reports.set(report.id, report);
    byCity.set(cityId, reports);
  };

  const takeQuota = (uid: string) => {
    const clock = now().getTime();
    const today = (sentAt.get(uid) ?? []).filter((t) => clock - t < DAY_MS);
    if (today.length >= PER_DAY || today.filter((t) => clock - t < HOUR_MS).length >= PER_HOUR) {
      throw new AppError(429, "TOO_MANY_REPORTS", "You have sent a lot of reports recently. Please try again later.");
    }
    sentAt.set(uid, [...today, clock]);
  };

  return {
    async load() {
      const reports = await store.observedSince(new Date(now().getTime() - MAX_AGE_MS));
      for (const { cityId, ...report } of reports) remember(cityId, report);
      return reports.length;
    },

    async submit(uid, { point, category, when }) {
      const city = cities.locate(point);
      if (!city) throw new AppError(422, "OUTSIDE_COVERAGE", "Reports must be inside a covered city");
      takeQuota(uid);
      const offset = city.data.utcOffsetMinutes;
      const observedAt = observedAtFor(when, now(), offset);
      const localDate = new Date(observedAt.getTime() + offset * 60_000).toISOString().slice(0, 10);
      const id = createHash("sha256").update([uid, category, spotOf(point), localDate].join("|")).digest("hex").slice(0, 32);
      const report: CommunityReport = { id, category, point, observedAt };
      await store.save({ ...report, cityId: city.id });
      remember(city.id, report);
      return report;
    },

    active(cityId) {
      const oldest = now().getTime() - MAX_AGE_MS;
      return [...(byCity.get(cityId)?.values() ?? [])].filter((r) => r.observedAt.getTime() >= oldest);
    },
  };
}
