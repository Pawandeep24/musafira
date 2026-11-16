import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LngLat } from "#src/geo/geometry.js";
import { cityDataSchema } from "#src/city/cityData.js";
import { CityIndex } from "#src/city/cityIndex.js";

export interface CityRegistry {
  readonly cities: readonly CityIndex[];
  locate(point: LngLat): CityIndex | undefined;
}

export function createCityRegistry(cities: readonly CityIndex[]): CityRegistry {
  return {
    cities,
    locate: (point) => cities.find((city) => city.contains(point)),
  };
}

export async function loadCityRegistry(directory: string): Promise<CityRegistry> {
  const files = (await readdir(directory).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
  const cities = await Promise.all(
    files.map(async (file) => {
      const raw: unknown = JSON.parse(await readFile(join(directory, file), "utf8"));
      return new CityIndex(cityDataSchema.parse(raw));
    }),
  );
  return createCityRegistry(cities);
}
