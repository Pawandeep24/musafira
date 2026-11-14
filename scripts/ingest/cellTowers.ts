/**
 * Builds a cell-ID density grid (cells per km²) from the OpenCelliD area API.
 *
 * The API caps each query at 4 km², so the city is tiled into ~2 km squares and
 * each tile costs one request (~300 per city, inside the 1,000/day free quota).
 * Requests run sequentially with a pause to respect the service.
 */
import { z } from "zod";
import type { Grid } from "../../src/city/cityData.js";
import type { BBox } from "../../src/geo/geometry.js";
import { haversineMeters } from "../../src/geo/geometry.js";
import { sleep, USER_AGENT } from "./cache.js";

const CELL_DEGREES = 0.018;
const PAUSE_MS = 250;

const countResponse = z.object({ count: z.number() });

async function countCells(key: string, south: number, west: number, north: number, east: number): Promise<number> {
  const params = new URLSearchParams({ key, BBOX: `${south},${west},${north},${east}`, format: "json" });
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://opencellid.org/cell/getInAreaSize?${params}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.ok) return countResponse.parse(await response.json()).count;
    if (attempt >= 3) throw new Error(`OpenCelliD returned HTTP ${response.status}`);
    await sleep(2000 * attempt);
  }
}

export async function buildCellDensityGrid(bbox: BBox, key: string, onProgress: (done: number, total: number) => void): Promise<Grid> {
  const cols = Math.ceil((bbox.east - bbox.west) / CELL_DEGREES);
  const rows = Math.ceil((bbox.north - bbox.south) / CELL_DEGREES);
  const values: number[] = [];

  for (let row = 0; row < rows; row++) {
    const north = bbox.north - row * CELL_DEGREES;
    const south = north - CELL_DEGREES;
    for (let col = 0; col < cols; col++) {
      const west = bbox.west + col * CELL_DEGREES;
      const east = west + CELL_DEGREES;
      const km2 = (haversineMeters([west, south], [east, south]) * haversineMeters([west, south], [west, north])) / 1e6;
      const count = await countCells(key, south, west, north, east);
      values.push(Math.round((count / km2) * 10) / 10);
      onProgress(values.length, rows * cols);
      await sleep(PAUSE_MS);
    }
  }
  return { west: bbox.west, north: bbox.north, cellDegrees: CELL_DEGREES, cols, rows, values };
}
