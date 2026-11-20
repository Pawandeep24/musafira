/**
 * Turns a cached RouteAnalysis into a 0-100 safety score for one set of weights.
 *
 *   segment score = weighted mean of the parameters measured on that segment
 *   base          = 0.6 × length-weighted mean + 0.4 × mean of the worst 10% of route length
 *   score         = 100 × base × (1 − penalties / 100)
 *
 * Penalties are percentages (dark stretches ≤ 25, signal dead zones ≤ 15, long
 * gaps between safety stops ≤ 15, stretches riders reported as unsafe ≤ 15).
 * Applying them as a share of the base, not by subtraction, keeps two bad routes
 * distinguishable instead of both flooring at 0.
 *
 * Missing data neither helps nor hurts a segment; it lowers `confidence` instead.
 * The worst-10% term and the penalties stop a long, well-lit main road from hiding
 * one isolated dark stretch, which averaging alone would do. Every penalty scales
 * with the weight of its parameter, so a rider who zeroes "lighting" sees no
 * dark-stretch penalty either. The reported-stretch penalty has no slider and
 * always applies: harassment reports are not something a rider opts out of.
 */
import { openStopPositions } from "#src/safety/features/along.js";
import { MAX_WEIGHT, PARAMETER_IDS, type ParameterId, type ScoringOptions, type Weights } from "#src/safety/parameters.js";
import { findStretches, longestGap } from "#src/safety/stretches.js";
import type { Measurement, RouteAnalysis, RouteScore, Stretch } from "#src/safety/types.js";

const MEAN_SHARE = 0.6;
const WORST_SHARE_OF_LENGTH = 0.1;
export const DARK_BELOW = 0.35;
export const DEAD_ZONE_BELOW = 0.25;
const DEAD_ZONE_MIN_METERS = 300;

const lengthOf = (s: Stretch) => s.endMeters - s.startMeters;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const isBelow = (value: Measurement | undefined, threshold: number) => typeof value === "number" && value < threshold;

function blendedBase(scores: readonly (number | null)[], lengths: readonly number[]): number | null {
  const measured = scores.flatMap((score, i) => (score === null ? [] : [{ score, length: lengths[i]! }]));
  const total = sum(measured.map((m) => m.length));
  if (total === 0) return null;
  const mean = sum(measured.map((m) => m.score * m.length)) / total;

  const worstFirst = [...measured].sort((a, b) => a.score - b.score);
  let covered = 0;
  let weighted = 0;
  for (const m of worstFirst) {
    if (covered >= total * WORST_SHARE_OF_LENGTH) break;
    covered += m.length;
    weighted += m.score * m.length;
  }
  return MEAN_SHARE * mean + (1 - MEAN_SHARE) * (weighted / covered);
}

function lengthWeightedMean(values: readonly Measurement[], lengths: readonly number[]): number | null {
  let total = 0;
  let weighted = 0;
  values.forEach((value, i) => {
    if (typeof value !== "number") return;
    total += lengths[i]!;
    weighted += value * lengths[i]!;
  });
  return total > 0 ? weighted / total : null;
}

function confidenceOf(analysis: RouteAnalysis, weights: Weights, lengths: readonly number[]): number {
  let earned = 0;
  let possible = 0;
  for (const id of PARAMETER_IDS) {
    if (weights[id] <= 0) continue;
    let applicable = 0;
    let measured = 0;
    analysis.measurements[id].forEach((value, i) => {
      if (value === "n/a") return;
      applicable += lengths[i]!;
      if (typeof value === "number") measured += lengths[i]!;
    });
    if (applicable === 0) continue;
    earned += weights[id] * (measured / applicable) * analysis.quality[id];
    possible += weights[id];
  }
  return possible > 0 ? round(earned / possible, 2) : 0;
}

export function scoreRoute(analysis: RouteAnalysis, weights: Weights, options: ScoringOptions): RouteScore {
  const { segments, measurements } = analysis;
  const lengths = segments.map((s) => s.endMeters - s.startMeters);
  const active = PARAMETER_IDS.filter((id) => weights[id] > 0);

  const segmentScores = segments.map((_, i) => {
    let weighted = 0;
    let weightSum = 0;
    for (const id of active) {
      const value = measurements[id][i];
      if (typeof value !== "number") continue;
      weighted += weights[id] * value;
      weightSum += weights[id];
    }
    return weightSum > 0 ? weighted / weightSum : null;
  });

  const darkStretches = findStretches(segments, (i) => isBelow(measurements.lighting[i], DARK_BELOW), options.darkStretchMeters);
  const deadZones = findStretches(segments, (i) => isBelow(measurements.signal[i], DEAD_ZONE_BELOW), DEAD_ZONE_MIN_METERS);
  const totalMeters = segments.at(-1)?.endMeters ?? 0;
  const longestStopGapMeters = Math.round(longestGap(openStopPositions(analysis.stops, "safety"), totalMeters));

  const scale = (id: ParameterId) => weights[id] / MAX_WEIGHT;
  const penalties = {
    darkStretches: round(
      scale("lighting") * Math.min(25, sum(darkStretches.map((s) => Math.min(15, 4 + (6 * lengthOf(s)) / 1000)))),
      1,
    ),
    deadZones: round(scale("signal") * Math.min(15, sum(deadZones.map((s) => Math.min(10, 2 + (4 * lengthOf(s)) / 1000)))), 1),
    stopGap: round(
      scale("safetyStops") *
        (longestStopGapMeters > options.maxStopGapMeters ? Math.min(15, (longestStopGapMeters - options.maxStopGapMeters) / 250) : 0),
      1,
    ),
    reported: round(Math.min(15, sum(analysis.reportedStretches.map((s) => Math.min(10, 5 + (5 * lengthOf(s)) / 1000)))), 1),
  };

  const base = blendedBase(segmentScores, lengths);
  const totalPenalty = penalties.darkStretches + penalties.deadZones + penalties.stopGap + penalties.reported;
  const score = base === null ? 0 : Math.min(100, Math.round(100 * base * (1 - totalPenalty / 100)));

  const breakdown = Object.fromEntries(
    PARAMETER_IDS.map((id) => {
      const mean = lengthWeightedMean(measurements[id], lengths);
      return [id, mean === null ? null : Math.round(mean * 100)];
    }),
  ) as Record<ParameterId, number | null>;

  return {
    score,
    confidence: confidenceOf(analysis, weights, lengths),
    breakdown,
    segmentScores: segmentScores.map((s) => (s === null ? null : round(s, 3))),
    darkStretches,
    deadZones,
    longestStopGapMeters,
    penalties,
  };
}
