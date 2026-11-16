import type { PoiCategory } from "#src/city/cityData.js";
import { saturate } from "#src/safety/curves.js";
import type { FeatureExtractor } from "#src/safety/types.js";

const RADIUS_METERS = 300;
const SERVICES_K = 1.5;
const IMPORTANCE: Partial<Record<PoiCategory, number>> = {
  hospital: 1,
  police: 1,
  clinic: 0.6,
  pharmacy: 0.5,
  doctors: 0.4,
  fuel: 0.4,
};

export const essentialServices: FeatureExtractor = {
  id: "essentialServices",
  measure({ segments }) {
    const values = segments.map((segment) => {
      const total = segment.nearby
        .filter((n) => n.distanceMeters <= RADIUS_METERS)
        .reduce((sum, n) => sum + (IMPORTANCE[n.poi.cat] ?? 0), 0);
      return saturate(total, SERVICES_K);
    });
    return { values, quality: 1 };
  },
};
