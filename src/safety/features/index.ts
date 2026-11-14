import type { ParameterId } from "../parameters.js";
import type { FeatureExtractor } from "../types.js";
import { breakdownHelp } from "./breakdownHelp.js";
import { crowd } from "./crowd.js";
import { essentialServices } from "./essentialServices.js";
import { lighting } from "./lighting.js";
import { openShops } from "./openShops.js";
import { roadType } from "./roadType.js";
import { safetyStops } from "./safetyStops.js";
import { signal } from "./signal.js";

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
