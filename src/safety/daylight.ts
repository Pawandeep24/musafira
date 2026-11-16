import { getPosition } from "suncalc";
import type { LngLat } from "#src/geo/geometry.js";

/** Civil dusk: below this sun altitude, street lighting is what you see by. */
const CIVIL_TWILIGHT_RADIANS = (-6 * Math.PI) / 180;

export function isDark([lon, lat]: LngLat, at: Date): boolean {
  return getPosition(at, lat, lon).altitude < CIVIL_TWILIGHT_RADIANS;
}
