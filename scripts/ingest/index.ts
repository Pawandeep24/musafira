import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cityDataSchema, type DataSource, type Grid } from "../../src/city/cityData.js";
import { loadEnv } from "../../src/config/env.js";
import { cachedJson } from "./cache.js";
import { buildCellDensityGrid } from "./cellTowers.js";
import { CITY_DEFINITIONS } from "./cities.js";
import { cropNightLights } from "./nightLights.js";
import { fetchOsmPlaceElements, toNamedPlaces } from "./osmPlaces.js";
import { fetchOsmPois } from "./osmPois.js";

const OUT_DIR = join(import.meta.dirname, "../../data/cities");

const OSM: DataSource = {
  name: "OpenStreetMap",
  license: "ODbL 1.0",
  attribution: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
};
const BLACK_MARBLE: DataSource = {
  name: "NASA Black Marble VNP46A4",
  license: "Public domain (NASA EOSDIS)",
  attribution: "Night lights: NASA Black Marble",
  url: "https://blackmarble.gsfc.nasa.gov/",
};
const OPENCELLID: DataSource = {
  name: "OpenCelliD",
  license: "CC BY-SA 4.0",
  attribution: "Cell data: OpenCelliD Project, CC BY-SA 4.0",
  url: "https://opencellid.org/",
};

async function optional<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    console.warn(`  ! ${label} skipped: ${(error as Error).message}`);
    return undefined;
  }
}

const env = loadEnv();
const requested = process.argv.slice(2);
const targets = requested.length ? CITY_DEFINITIONS.filter((c) => requested.includes(c.id)) : CITY_DEFINITIONS;
if (targets.length === 0) throw new Error(`Unknown city. Known: ${CITY_DEFINITIONS.map((c) => c.id).join(", ")}`);
await mkdir(OUT_DIR, { recursive: true });

for (const city of targets) {
  console.log(`\n== ${city.name}`);

  const pois = await cachedJson(`${city.id}-osm-pois.json`, () => fetchOsmPois(city.bbox));
  console.log(`  points of interest: ${pois.length} (${pois.filter((p) => p.hours).length} with opening hours)`);

  const places = toNamedPlaces(await cachedJson(`${city.id}-osm-places.json`, () => fetchOsmPlaceElements(city.bbox)));
  console.log(`  searchable places: ${places.length} (${places.filter((p) => p.kind === "residence").length} housing societies)`);

  const lights = await optional("night lights", () =>
    cachedJson(`${city.id}-night-lights.json`, () => cropNightLights(city.bbox, env.NASA_EARTHDATA_TOKEN)),
  );
  if (lights) console.log(`  night lights: ${lights.grid.cols}×${lights.grid.rows} grid from ${lights.file}`);

  const key = env.OPENCELLID_API_KEY;
  const cellDensity: Grid | undefined = key
    ? await optional("cell density", () =>
        cachedJson(`${city.id}-cell-density.json`, () =>
          buildCellDensityGrid(city.bbox, key, (done, total) => {
            if (done % 25 === 0 || done === total) process.stdout.write(`\r  cell density: ${done}/${total} tiles`);
          }),
        ),
      )
    : undefined;
  if (cellDensity) console.log(`\n  cell density: ${cellDensity.cols}×${cellDensity.rows} grid`);

  const data = cityDataSchema.parse({
    ...city,
    version: new Date().toISOString().slice(0, 10),
    pois,
    places,
    ...(lights ? { lights: lights.grid } : {}),
    ...(cellDensity ? { cellDensity } : {}),
    sources: [OSM, ...(lights ? [BLACK_MARBLE] : []), ...(cellDensity ? [OPENCELLID] : [])],
  });
  const path = join(OUT_DIR, `${city.id}.json`);
  await writeFile(path, JSON.stringify(data));
  console.log(`  wrote ${path}`);
}
