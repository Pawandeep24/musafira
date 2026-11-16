import KDBush from "kdbush";
import { bboxContains, createLocalProjection, type LngLat, type LocalProjection } from "#src/geo/geometry.js";
import type { CityData, Grid, Poi } from "#src/city/cityData.js";
import { PlaceSearch } from "#src/city/placeSearch.js";

export interface NearbyPoi {
  readonly poi: Poi;
  readonly distanceMeters: number;
}

function gridValueAt(grid: Grid | undefined, [lon, lat]: LngLat): number | undefined {
  if (!grid) return undefined;
  const col = Math.floor((lon - grid.west) / grid.cellDegrees);
  const row = Math.floor((grid.north - lat) / grid.cellDegrees);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return undefined;
  return grid.values[row * grid.cols + col] ?? undefined;
}

/** Read-only, in-memory view of one city's ingested data with a metre-based POI index. */
export class CityIndex {
  readonly #projection: LocalProjection;
  readonly #poiIndex: KDBush;
  readonly places: PlaceSearch;

  constructor(readonly data: CityData) {
    this.places = new PlaceSearch(data);
    this.#projection = createLocalProjection(data.center);
    this.#poiIndex = new KDBush(data.pois.length);
    for (const poi of data.pois) {
      const [x, y] = this.#projection.toMeters([poi.lon, poi.lat]);
      this.#poiIndex.add(x, y);
    }
    this.#poiIndex.finish();
  }

  get id(): string {
    return this.data.id;
  }

  contains(point: LngLat): boolean {
    return bboxContains(this.data.bbox, point);
  }

  poisWithin(point: LngLat, radiusMeters: number): NearbyPoi[] {
    const [x, y] = this.#projection.toMeters(point);
    return this.#poiIndex.within(x, y, radiusMeters).flatMap((i) => {
      const poi = this.data.pois[i];
      if (!poi) return [];
      const [px, py] = this.#projection.toMeters([poi.lon, poi.lat]);
      return [{ poi, distanceMeters: Math.hypot(px - x, py - y) }];
    });
  }

  /** Night-time radiance in nW/cm²/sr. */
  radianceAt(point: LngLat): number | undefined {
    return gridValueAt(this.data.lights, point);
  }

  /** Mobile cell IDs per km². */
  cellDensityAt(point: LngLat): number | undefined {
    return gridValueAt(this.data.cellDensity, point);
  }
}
