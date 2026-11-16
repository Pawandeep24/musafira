import type { ParameterId } from "#src/safety/parameters.js";
import type { FeatureExtractor } from "#src/safety/types.js";
import { breakdownHelp } from "#src/safety/features/breakdownHelp.js";
import { crowd } from "#src/safety/features/crowd.js";
import { essentialServices } from "#src/safety/features/essentialServices.js";
import { lighting } from "#src/safety/features/lighting.js";
import { openShops } from "#src/safety/features/openShops.js";
import { roadType } from "#src/safety/features/roadType.js";
import { safetyStops } from "#src/safety/features/safetyStops.js";
import { signal } from "#src/safety/features/signal.js";

export const FEATURE_EXTRACTORS: Readonly<Record<ParameterId, FeatureExtractor>> = {
  lighting,
  safetyStops,
  crowd,
  signal,
  essentialServices,
  openShops,
  breakdownHelp,
  roadType,
};
