import type { FeatureExtractor, Measurement } from "#src/safety/types.js";

const ROAD_SAFETY: Readonly<Record<string, number>> = {
  primary: 1,
  secondary: 0.95,
  trunk: 0.9,
  tertiary: 0.8,
  residential: 0.6,
  living_street: 0.55,
  motorway: 0.5,
  unclassified: 0.45,
  service_other: 0.35,
  service_road: 0.35,
  parking_aisle: 0.3,
  alley: 0.25,
  driveway: 0.25,
  track: 0.1,
};
const UNKNOWN_ROAD_SAFETY = 0.4;
const DARK_TUNNEL_FACTOR = 0.6;

export const roadType: FeatureExtractor = {
  id: "roadType",
  measure({ segments }) {
    const values = segments.map((segment): Measurement => {
      if (!segment.roadClass) return "missing";
      const base = ROAD_SAFETY[segment.roadClass] ?? UNKNOWN_ROAD_SAFETY;
      return segment.tunnel && segment.dark ? base * DARK_TUNNEL_FACTOR : base;
    });
    return { values, quality: 1 };
  },
};
