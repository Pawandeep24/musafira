import { proximity } from "../curves.js";
import type { FeatureExtractor } from "../types.js";
import { hoursQuality, midMeters, nearestAlong, openStopPositions } from "./along.js";

const HALF_SCORE_AT_METERS = 2000;

export const breakdownHelp: FeatureExtractor = {
  id: "breakdownHelp",
  measure({ segments, stops }) {
    const positions = openStopPositions(stops, "breakdown");
    return {
      values: segments.map((s) => proximity(nearestAlong(positions, midMeters(s)), HALF_SCORE_AT_METERS)),
      quality: hoursQuality(stops, "breakdown"),
    };
  },
};
