import type { Grid, LngLat } from "../api/types";
import type { Rgba } from "../lib/colors";

export interface GridDot {
  readonly position: LngLat;
  readonly color: Rgba;
  readonly radius: number;
}

interface DotStyle {
  readonly color: Rgba;
  readonly scale: number;
}

const METERS_PER_DEGREE = 111_320;

/** One dot per grid cell: an LED-matrix look that stays honest about how coarse the data is. */
export function gridDots(grid: Grid, styleOf: (value: number) => DotStyle | null): GridDot[] {
  const halfCellMeters = (grid.cellDegrees * METERS_PER_DEGREE) / 2;
  const dots: GridDot[] = [];
  grid.values.forEach((value, i) => {
    const style = value === null ? null : styleOf(value);
    if (!style) return;
    const col = i % grid.cols;
    const row = Math.floor(i / grid.cols);
    dots.push({
      position: [grid.west + (col + 0.5) * grid.cellDegrees, grid.north - (row + 0.5) * grid.cellDegrees],
      color: style.color,
      radius: halfCellMeters * style.scale,
    });
  });
  return dots;
}

export function nightLightDot(radiance: number): DotStyle | null {
  const t = Math.min(1, (radiance - 8) / 45);
  if (t <= 0) return null;
  return { color: [255, Math.round(160 + 80 * t), Math.round(70 + 120 * t), Math.round(50 + 170 * t)], scale: 0.06 + 0.2 * t };
}

export function signalDot(cellsPerKm2: number): DotStyle | null {
  if (cellsPerKm2 < 4) return { color: [255, 61, 110, 200], scale: 0.18 };
  const strength = 1 - Math.exp(-cellsPerKm2 / 15);
  return { color: [46, 200, 255, Math.round(60 + 120 * strength)], scale: 0.04 + 0.08 * strength };
}
