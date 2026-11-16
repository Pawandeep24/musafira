import { saturate } from "#src/safety/curves.js";
import type { FeatureExtractor, Measurement } from "#src/safety/types.js";

/** Cell IDs per km²; one tower site usually carries 6-12 IDs (sectors × radio types). */
const DENSITY_K = 15;
const CROWDSOURCED_QUALITY = 0.8;

export const signal: FeatureExtractor = {
  id: "signal",
  measure({ segments, cellDensityAt }) {
    const values = segments.map((segment): Measurement => {
      const density = cellDensityAt(segment.midpoint);
      return density === undefined ? "missing" : saturate(density, DENSITY_K);
    });
    return { values, quality: CROWDSOURCED_QUALITY };
  },
};
