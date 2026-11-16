import { saturate } from "#src/safety/curves.js";
import type { FeatureExtractor } from "#src/safety/types.js";
import { STOREFRONTS } from "#src/safety/features/categories.js";

const RADIUS_METERS = 100;
const SHOPS_K = 4;
const STILL_OPEN_AFTER_MS = 15 * 60_000;

export const openShops: FeatureExtractor = {
  id: "openShops",
  measure({ segments, isOpen }) {
    let considered = 0;
    let real = 0;
    const values = segments.map((segment) => {
      const later = new Date(segment.arrival.getTime() + STILL_OPEN_AFTER_MS);
      const open = segment.nearby.filter((n) => {
        if (n.distanceMeters > RADIUS_METERS || !STOREFRONTS.has(n.poi.cat)) return false;
        const now = isOpen(n.poi, segment.arrival);
        considered++;
        if (!now.estimated) real++;
        return now.open && isOpen(n.poi, later).open;
      });
      return saturate(open.length, SHOPS_K);
    });
    return { values, quality: considered ? 0.5 + (0.5 * real) / considered : 0.5 };
  },
};
