/**
 * Rider reports as evidence that corrects the sensor-based measurements.
 *
 * A report touches each segment it lies near with weight
 *   w = 2^(−age / half-life) × time match × falloff
 *   age         days from the report to when the rider reaches the segment (never negative)
 *   time match  lighting: 1 on dark segments, else 0. People around and personal safety: 1 in the
 *               same band of the day (morning 6–12, afternoon 12–17, evening 17–21, night 21–6),
 *               0.5 in the next band, 0.15 in the opposite one. Road and signal: 1 at any hour.
 *   falloff     1 within 30 m of the segment, fading to 0 at 80 m
 *
 * Positive (E⁺) and negative (E⁻) evidence blend into the sensor value v:
 *   v' = (2v + E⁺) / (2 + E⁺ + E⁻)
 * so the sensor counts like two fresh reports: one report nudges it, three overturn it.
 * Without sensor data a neutral 0.5 prior counts as one report, and only once there is at
 * least 0.5 of evidence. "n/a" stays "n/a": a lighting report cannot make daytime dark.
 *
 * Personal-safety reports have no sensor to correct. Segments whose net negative evidence
 * reaches 0.5 form reported stretches, which scoring penalises whatever the rider's weights.
 * Bands use the city's clock, so a report from 23:00 IST matches a ride at 22:30 IST.
 *
 * For the map, reports of one category in the same ~110 m spot merge into one marker.
 */
import { bboxContains, distanceToPathMeters, haversineMeters, type BBox, type LngLat } from "#src/geo/geometry.js";
import type { ParameterId } from "#src/safety/parameters.js";
import { findStretches } from "#src/safety/stretches.js";
import type { Measurement, Segment, Stretch } from "#src/safety/types.js";

export const REPORT_CATEGORIES = [
  "poorlyLit",
  "wellLit",
  "deserted",
  "busy",
  "harassment",
  "loitering",
  "policeNearby",
  "badRoad",
  "waterlogged",
  "noSignal",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const DAY_BANDS = ["morning", "afternoon", "evening", "night"] as const;
export type DayBand = (typeof DAY_BANDS)[number];
export const REPORT_WHEN = ["now", ...DAY_BANDS] as const;
export type ReportWhen = (typeof REPORT_WHEN)[number];

export interface CommunityReport {
  readonly id: string;
  readonly category: ReportCategory;
  readonly point: LngLat;
  readonly observedAt: Date;
}

/** Reports of one category grouped where they touch the route. */
export interface RouteReport {
  readonly category: ReportCategory;
  readonly alongMeters: number;
  readonly count: number;
  readonly lastObservedAt: Date;
}

/** Reports of one category merged per spot, for drawing on the map. */
export interface SpotReport {
  readonly category: ReportCategory;
  readonly point: LngLat;
  readonly count: number;
  readonly lastObservedAt: Date;
  readonly reportIds: readonly string[];
}

type CorrectedParameter = Extract<ParameterId, "lighting" | "crowd" | "roadType" | "signal">;
type Target = CorrectedParameter | "personal";
type Timing = "dark" | "band" | "always";

const RULES: Record<ReportCategory, { target: Target; positive: boolean; halfLifeDays: number; timing: Timing }> = {
  poorlyLit: { target: "lighting", positive: false, halfLifeDays: 30, timing: "dark" },
  wellLit: { target: "lighting", positive: true, halfLifeDays: 30, timing: "dark" },
  deserted: { target: "crowd", positive: false, halfLifeDays: 21, timing: "band" },
  busy: { target: "crowd", positive: true, halfLifeDays: 21, timing: "band" },
  harassment: { target: "personal", positive: false, halfLifeDays: 90, timing: "band" },
  loitering: { target: "personal", positive: false, halfLifeDays: 30, timing: "band" },
  policeNearby: { target: "personal", positive: true, halfLifeDays: 14, timing: "band" },
  badRoad: { target: "roadType", positive: false, halfLifeDays: 60, timing: "always" },
  waterlogged: { target: "roadType", positive: false, halfLifeDays: 7, timing: "always" },
  noSignal: { target: "signal", positive: false, halfLifeDays: 60, timing: "always" },
};

const CORRECTED: readonly CorrectedParameter[] = ["lighting", "crowd", "roadType", "signal"];
const FULL_WEIGHT_METERS = 30;
const REACH_METERS = 80;
const SENSOR_WEIGHT = 2;
const NEUTRAL_PRIOR = 0.5;
const MIN_WEIGHT = 0.02;
const MIN_EVIDENCE_WITHOUT_SENSOR = 0.5;
const REPORTED_AT = 0.5;
const GROUP_METERS = 200;
const SPOT_DEGREES = 0.001;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BAND_MIDPOINT_HOURS: Record<DayBand, number> = { morning: 9, afternoon: 14.5, evening: 19, night: 1.5 };

const localHour = (at: Date, utcOffsetMinutes: number) => (((at.getTime() / HOUR_MS + utcOffsetMinutes / 60) % 24) + 24) % 24;

export const spotOf = (point: LngLat) => point.map((v) => Math.round(v / SPOT_DEGREES)).join(":");

export function spotsWithin(reports: readonly CommunityReport[], box: BBox): SpotReport[] {
  const spots = new Map<string, CommunityReport[]>();
  for (const report of reports) {
    if (!bboxContains(box, report.point)) continue;
    const key = `${report.category}|${spotOf(report.point)}`;
    const members = spots.get(key);
    if (members) members.push(report);
    else spots.set(key, [report]);
  }
  return [...spots.values()].map((members) => {
    const mean = (axis: 0 | 1) => members.reduce((sum, r) => sum + r.point[axis], 0) / members.length;
    return {
      category: members[0]!.category,
      point: [mean(0), mean(1)],
      count: members.length,
      lastObservedAt: new Date(Math.max(...members.map((r) => r.observedAt.getTime()))),
      reportIds: members.map((r) => r.id),
    };
  });
}

export function bandOf(at: Date, utcOffsetMinutes: number): DayBand {
  const hour = localHour(at, utcOffsetMinutes);
  return hour >= 21 || hour < 6 ? "night" : hour >= 17 ? "evening" : hour >= 12 ? "afternoon" : "morning";
}

/** When a report happened: now, or the most recent time of the chosen band of the day. */
export function observedAtFor(when: ReportWhen, now: Date, utcOffsetMinutes: number): Date {
  if (when === "now" || bandOf(now, utcOffsetMinutes) === when) return now;
  const hoursSince = (localHour(now, utcOffsetMinutes) - BAND_MIDPOINT_HOURS[when] + 24) % 24;
  return new Date(now.getTime() - hoursSince * HOUR_MS);
}

function timeMatch(timing: Timing, segment: Segment, observedAt: Date, utcOffsetMinutes: number): number {
  if (timing === "always") return 1;
  if (timing === "dark") return segment.dark ? 1 : 0;
  const gap = Math.abs(DAY_BANDS.indexOf(bandOf(observedAt, utcOffsetMinutes)) - DAY_BANDS.indexOf(bandOf(segment.arrival, utcOffsetMinutes)));
  return gap === 0 ? 1 : gap === 2 ? 0.15 : 0.5;
}

const falloff = (meters: number) => (meters <= FULL_WEIGHT_METERS ? 1 : Math.max(0, (REACH_METERS - meters) / (REACH_METERS - FULL_WEIGHT_METERS)));

function correct(value: Measurement, positive: number, negative: number): Measurement {
  const total = positive + negative;
  if (value === "n/a" || total === 0) return value;
  if (value === "missing") return total < MIN_EVIDENCE_WITHOUT_SENSOR ? value : (NEUTRAL_PRIOR + positive) / (1 + total);
  return (SENSOR_WEIGHT * value + positive) / (SENSOR_WEIGHT + total);
}

interface Match {
  readonly category: ReportCategory;
  readonly alongMeters: number;
  readonly observedAt: Date;
}

function groupAlong(matches: readonly Match[]): RouteReport[] {
  const groups: { category: ReportCategory; alongMeters: number; count: number; lastObservedAt: Date }[] = [];
  for (const match of [...matches].sort((a, b) => a.alongMeters - b.alongMeters)) {
    const group = groups.findLast((g) => g.category === match.category && match.alongMeters - g.alongMeters <= GROUP_METERS);
    if (!group) {
      groups.push({ ...match, count: 1, lastObservedAt: match.observedAt });
      continue;
    }
    group.count += 1;
    if (match.observedAt > group.lastObservedAt) group.lastObservedAt = match.observedAt;
  }
  return groups.map(({ category, alongMeters, count, lastObservedAt }) => ({ category, alongMeters: Math.round(alongMeters), count, lastObservedAt }));
}

export interface CommunityEvidence {
  readonly measurements: Readonly<Record<ParameterId, readonly Measurement[]>>;
  readonly reportedStretches: readonly Stretch[];
  readonly reports: readonly RouteReport[];
  readonly reportIds: readonly string[];
}

export function applyReports(
  segments: readonly Segment[],
  measurements: Readonly<Record<ParameterId, readonly Measurement[]>>,
  reports: readonly CommunityReport[],
  utcOffsetMinutes: number,
): CommunityEvidence {
  const positive = Object.fromEntries([...CORRECTED, "personal"].map((t) => [t, segments.map(() => 0)])) as Record<Target, number[]>;
  const negative = Object.fromEntries([...CORRECTED, "personal"].map((t) => [t, segments.map(() => 0)])) as Record<Target, number[]>;
  const matches: Match[] = [];
  const reportIds: string[] = [];

  for (const report of reports) {
    const rule = RULES[report.category];
    let strongest: { alongMeters: number; weight: number } | undefined;
    segments.forEach((segment, i) => {
      const length = segment.endMeters - segment.startMeters;
      if (haversineMeters(report.point, segment.midpoint) > REACH_METERS + length) return;
      const ageDays = Math.max(0, (segment.arrival.getTime() - report.observedAt.getTime()) / DAY_MS);
      const weight =
        2 ** (-ageDays / rule.halfLifeDays) *
        timeMatch(rule.timing, segment, report.observedAt, utcOffsetMinutes) *
        falloff(distanceToPathMeters(report.point, segment.path));
      if (weight < MIN_WEIGHT) return;
      (rule.positive ? positive : negative)[rule.target][i]! += weight;
      if (!strongest || weight > strongest.weight) strongest = { alongMeters: (segment.startMeters + segment.endMeters) / 2, weight };
    });
    if (!strongest) continue;
    matches.push({ category: report.category, alongMeters: strongest.alongMeters, observedAt: report.observedAt });
    reportIds.push(report.id);
  }

  const corrected = { ...measurements };
  for (const id of CORRECTED) {
    corrected[id] = measurements[id].map((value, i) => correct(value, positive[id][i]!, negative[id][i]!));
  }
  return {
    measurements: corrected,
    reportedStretches: findStretches(segments, (i) => negative.personal[i]! - positive.personal[i]! >= REPORTED_AT, 0),
    reports: groupAlong(matches),
    reportIds,
  };
}
