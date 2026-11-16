import type { PoiCategory } from "@/api/types";

export type Rgba = [number, number, number, number];
export type Rgb = readonly [number, number, number];
type Ramp = readonly (readonly [stop: number, color: Rgb])[];

const DAY_MAX_LIGHTNESS = 0.56;
const DAY_CHROMA_BOOST = 1.3;

const toLinear = (channel: number) => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

/**
 * Day-map ink: the same hue with OKLab lightness capped at 0.56 and chroma ×1.3.
 * Map colours are picked to glow on the night basemap; on the light day basemap the
 * pastels (safety green and teal, amber, night lights) fall to ~1.2:1 contrast. Capping
 * lightness in OKLab, which tracks perceived lightness, lifts them to ~3:1 without
 * turning yellow and green muddy the way RGB or HSL darkening does.
 */
export function deepen([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const lightness = Math.min(DAY_MAX_LIGHTNESS, 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
  const a = DAY_CHROMA_BOOST * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s);
  const bb = DAY_CHROMA_BOOST * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
  const l3 = (lightness + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m3 = (lightness - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s3 = (lightness - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    toSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    toSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    toSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

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
