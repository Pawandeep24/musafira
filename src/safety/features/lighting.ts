import { saturate } from "#src/safety/curves.js";
import type { FeatureExtractor, Measurement } from "#src/safety/types.js";

const ROAD_LIGHTING: Readonly<Record<string, number>> = {
  trunk: 0.85,
  primary: 0.85,
  secondary: 0.75,
  motorway: 0.7,
  tertiary: 0.6,
  residential: 0.5,
  living_street: 0.45,
  unclassified: 0.4,
  service_other: 0.3,
  service_road: 0.3,
  parking_aisle: 0.3,
  alley: 0.2,
  driveway: 0.2,
  track: 0.1,
};
const UNKNOWN_ROAD_LIGHTING = 0.4;
const RADIANCE_K = 20;
const SATELLITE_SHARE = 0.65;

export const lighting: FeatureExtractor = {
  id: "lighting",
  measure({ segments, radianceAt }) {
    let measured = 0;
    let withSatellite = 0;
    const values = segments.map((segment): Measurement => {
      if (!segment.dark) return "n/a";
      const road = segment.roadClass ? (ROAD_LIGHTING[segment.roadClass] ?? UNKNOWN_ROAD_LIGHTING) : undefined;
      const radiance = radianceAt(segment.midpoint);
      if (radiance === undefined && road === undefined) return "missing";
      measured++;
      if (radiance === undefined) return road!;
      withSatellite++;
      const sky = saturate(radiance, RADIANCE_K);
      return road === undefined ? sky : SATELLITE_SHARE * sky + (1 - SATELLITE_SHARE) * road;
    });
    return { values, quality: measured ? 0.6 + (0.4 * withSatellite) / measured : 1 };
  },
};
