import type { PoiCategory } from "../../city/cityData.js";

export const STOREFRONTS: ReadonlySet<PoiCategory> = new Set([
  "shop",
  "convenience",
  "supermarket",
  "restaurant",
  "cafe",
  "fast_food",
  "pharmacy",
]);

export const ACTIVITY: ReadonlySet<PoiCategory> = new Set([
  ...STOREFRONTS,
  "fuel",
  "bus_stop",
  "transit_station",
  "hotel",
  "hospital",
]);

/** Staffed places a rider can pull into for help, if open at arrival. */
export const SAFETY_STOPS: ReadonlySet<PoiCategory> = new Set([
  "police",
  "hospital",
  "fuel",
  "pharmacy",
  "hotel",
  "convenience",
  "clinic",
  "safe_stop",
]);

export const BREAKDOWN_HELP: ReadonlySet<PoiCategory> = new Set(["fuel", "bike_repair"]);
