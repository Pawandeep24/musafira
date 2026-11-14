import { proximity } from "../curves.js";
import type { FeatureExtractor } from "../types.js";
import { hoursQuality, midMeters, nearestAlong, openStopPositions } from "./along.js";

const HALF_SCORE_AT_METERS = 750;

export const safetyStops: FeatureExtractor = {
  id: "safetyStops",
  measure({ segments, stops }) {
    const positions = openStopPositions(stops, "safety");
    return {
      values: segments.map((s) => proximity(nearestAlong(positions, midMeters(s)), HALF_SCORE_AT_METERS)),
      quality: hoursQuality(stops, "safety"),
    };
  },
};
