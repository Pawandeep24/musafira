import { clamp01, saturate } from "../curves.js";
import type { FeatureExtractor, TrafficSample } from "../types.js";
import { midMeters } from "./along.js";
import { ACTIVITY } from "./categories.js";

const RADIUS_METERS = 100;
const ACTIVITY_K = 5;
const TRAFFIC_REACH_METERS = 1000;

/**
 * Probe-vehicle confidence says traffic is being observed at all; slowdown versus
 * free flow says the road is busy. Either is evidence of people nearby.
 */
function trafficPresence(sample: TrafficSample): number {
  const slowdown = clamp01((1 - sample.currentSpeedKmh / Math.max(1, sample.freeFlowSpeedKmh)) / 0.5);
  return clamp01(sample.confidence * (0.35 + 0.65 * slowdown));
}

export const crowd: FeatureExtractor = {
  id: "crowd",
  measure({ segments, traffic, isOpen }) {
    let qualitySum = 0;
    const values = segments.map((segment) => {
      const considered = segment.nearby.filter((n) => n.distanceMeters <= RADIUS_METERS && ACTIVITY.has(n.poi.cat));
      const states = considered.map((n) => isOpen(n.poi, segment.arrival));
      const activity = saturate(states.filter((s) => s.open).length, ACTIVITY_K);

      const along = midMeters(segment);
      const sample = traffic
        .filter((t) => Math.abs(t.alongMeters - along) <= TRAFFIC_REACH_METERS)
        .sort((a, b) => Math.abs(a.alongMeters - along) - Math.abs(b.alongMeters - along))[0];

      const realShare = states.length ? states.filter((s) => !s.estimated).length / states.length : 0;
      qualitySum += sample ? 1 : 0.5 + 0.5 * realShare;
      return sample ? Math.max(activity, trafficPresence(sample)) : activity;
    });
    return { values, quality: segments.length ? qualitySum / segments.length : 1 };
  },
};
