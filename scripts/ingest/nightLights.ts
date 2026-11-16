/**
 * Crops NASA Black Marble VNP46A4 (yearly VIIRS night lights, 15 arc-second grid)
 * to a city's bounding box.
 *
 * The HDF5 tile is downloaded once into data/raw with an Earthdata bearer token.
 * Values are radiance in nW/cm²/sr; the file's fill value (-999.9) becomes null.
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import h5wasm from "h5wasm/node";
import { z } from "zod";
import type { Grid } from "#src/city/cityData.js";
import type { BBox } from "#src/geo/geometry.js";
import { RAW_DIR, USER_AGENT } from "#scripts/ingest/cache.js";

const DATA_FIELDS = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields";
const RADIANCE = `${DATA_FIELDS}/AllAngle_Composite_Snow_Free`;
const CELL_DEGREES = 15 / 3600;

const cmrResponse = z.object({
  feed: z.object({ entry: z.array(z.object({ links: z.array(z.object({ href: z.string() })) })) }),
});

async function latestGranuleUrl(bbox: BBox): Promise<string> {
  const params = new URLSearchParams({
    short_name: "VNP46A4",
    bounding_box: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    sort_key: "-start_date",
    page_size: "1",
  });
  const response = await fetch(`https://cmr.earthdata.nasa.gov/search/granules.json?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`NASA CMR returned HTTP ${response.status}`);
  const { feed } = cmrResponse.parse(await response.json());
  const href = feed.entry[0]?.links.map((l) => l.href).find((h) => h.startsWith("https") && h.endsWith(".h5"));
  if (!href) throw new Error("No VNP46A4 granule found for this area");
  return href;
}

async function ensureTile(bbox: BBox, token: string | undefined): Promise<string> {
  const url = await latestGranuleUrl(bbox);
  const path = join(RAW_DIR, url.split("/").pop()!);
  if (existsSync(path)) return path;
  if (!token) throw new Error("NASA_EARTHDATA_TOKEN is required to download night-light data");
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw new Error(`NASA download returned HTTP ${response.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(path));
  return path;
}

function indexRange(axis: Float64Array, low: number, high: number): [number, number] {
  const inside = [...axis.keys()].filter((i) => axis[i]! >= low && axis[i]! <= high);
  if (inside.length === 0) throw new Error("City is outside the night-light tile");
  return [Math.min(...inside), Math.max(...inside) + 1];
}

export async function cropNightLights(bbox: BBox, token: string | undefined): Promise<{ grid: Grid; file: string }> {
  const path = await ensureTile(bbox, token);
  await h5wasm.ready;
  const file = new h5wasm.File(path, "r");
  try {
    const dataset = (name: string) => file.get(name) as InstanceType<typeof h5wasm.Dataset>;
    const lats = dataset(`${DATA_FIELDS}/lat`).value as Float64Array;
    const lons = dataset(`${DATA_FIELDS}/lon`).value as Float64Array;
    const [row0, row1] = indexRange(lats, bbox.south, bbox.north);
    const [col0, col1] = indexRange(lons, bbox.west, bbox.east);
    const raw = dataset(RADIANCE).slice([
      [row0, row1],
      [col0, col1],
    ]) as Float32Array;

    return {
      file: path.split("/").pop()!,
      grid: {
        west: lons[col0]! - CELL_DEGREES / 2,
        north: lats[row0]! + CELL_DEGREES / 2,
        cellDegrees: CELL_DEGREES,
        cols: col1 - col0,
        rows: row1 - row0,
        values: Array.from(raw, (v) => (v < 0 ? null : Math.round(v * 10) / 10)),
      },
    };
  } finally {
    file.close();
  }
}
