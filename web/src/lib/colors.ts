import type { PoiCategory } from "../api/types";

export type Rgba = [number, number, number, number];
type Rgb = readonly [number, number, number];
type Ramp = readonly (readonly [stop: number, color: Rgb])[];

function sampleRamp(ramp: Ramp, value: number): Rgb {
  const first = ramp[0]!;
  const last = ramp[ramp.length - 1]!;
  if (value <= first[0]) return first[1];
  for (let i = 1; i < ramp.length; i++) {
    const [stop, color] = ramp[i]!;
    const [previousStop, previous] = ramp[i - 1]!;
    if (value <= stop) {
      const t = (value - previousStop) / (stop - previousStop);
      return [0, 1, 2].map((c) => Math.round(previous[c]! + (color[c]! - previous[c]!) * t)) as unknown as Rgb;
    }
  }
  return last[1];
}

const SAFETY: Ramp = [
  [0, [255, 61, 110]],
  [0.42, [255, 140, 90]],
  [0.6, [255, 196, 87]],
  [0.78, [126, 232, 170]],
  [1, [46, 242, 200]],
];
const NO_DATA: Rgb = [118, 128, 160];

export const safetyRgb = (value: number | null): Rgb => (value === null ? NO_DATA : sampleRamp(SAFETY, value));
export const safetyRgba = (value: number | null, alpha = 255): Rgba => [...safetyRgb(value), alpha];
export const safetyCss = (value: number | null, alpha = 1) => `rgba(${safetyRgb(value).join(",")},${alpha})`;

/** Sky colour across the day, used for the time scrubber and the ambient tint. */
const SKY: Ramp = [
  [0, [8, 10, 28]],
  [5, [20, 18, 52]],
  [6.3, [255, 140, 110]],
  [8, [96, 170, 255]],
  [16.5, [110, 180, 255]],
  [18, [255, 120, 120]],
  [19, [70, 40, 120]],
  [20.5, [14, 14, 40]],
  [24, [8, 10, 28]],
];

export const skyRgb = (hour: number): Rgb => sampleRamp(SKY, ((hour % 24) + 24) % 24);

export function skyGradient(startHour: number, hours: number, steps = 24): string {
  const stops = Array.from({ length: steps + 1 }, (_, i) => {
    const [r, g, b] = skyRgb(startHour + (hours * i) / steps);
    return `rgb(${r},${g},${b}) ${((i / steps) * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export const CATEGORY_RGB: Record<PoiCategory, Rgb> = {
  police: [90, 169, 255],
  hospital: [255, 95, 143],
  clinic: [255, 130, 170],
  doctors: [255, 130, 170],
  pharmacy: [92, 230, 150],
  fuel: [255, 190, 80],
  hotel: [168, 140, 255],
  convenience: [46, 242, 200],
  supermarket: [46, 242, 200],
  shop: [46, 242, 200],
  restaurant: [255, 160, 110],
  cafe: [255, 160, 110],
  fast_food: [255, 160, 110],
  bike_repair: [255, 214, 102],
  bus_stop: [140, 160, 220],
  transit_station: [140, 160, 220],
  safe_stop: [214, 140, 255],
};

export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  police: "Police",
  hospital: "Hospital",
  clinic: "Clinic",
  doctors: "Doctor",
  pharmacy: "Pharmacy",
  fuel: "Fuel pump",
  hotel: "Hotel (24h desk)",
  convenience: "Convenience store",
  supermarket: "Supermarket",
  shop: "Shop",
  restaurant: "Restaurant",
  cafe: "Café",
  fast_food: "Food stall",
  bike_repair: "Tyre & bike repair",
  bus_stop: "Bus stop",
  transit_station: "Station",
  safe_stop: "Musafira Safe Stop",
};
