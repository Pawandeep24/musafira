export type LngLat = readonly [lon: number, lat: number];

export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_M) / 180;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolate(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function bboxContains(box: BBox, [lon, lat]: LngLat): boolean {
  return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;
}

export function bboxAround(points: readonly LngLat[], paddingMeters: number): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const latPadding = paddingMeters / METERS_PER_DEGREE;
  const lonPadding = latPadding / Math.cos(toRadians((south + north) / 2));
  return { west: west - lonPadding, south: south - latPadding, east: east + lonPadding, north: north + latPadding };
}

export interface LocalProjection {
  toMeters(point: LngLat): readonly [x: number, y: number];
}

/**
 * Equirectangular projection around a fixed origin. Within a city (< 50 km) the
 * distortion is well under 1%, which lets spatial indexes work in plain metres.
 */
export function createLocalProjection(origin: LngLat): LocalProjection {
  const lonScale = METERS_PER_DEGREE * Math.cos(toRadians(origin[1]));
  return {
    toMeters: ([lon, lat]) => [(lon - origin[0]) * lonScale, (lat - origin[1]) * METERS_PER_DEGREE],
  };
}

export function distanceToPathMeters(point: LngLat, path: readonly LngLat[]): number {
  const { toMeters } = createLocalProjection(point);
  const vertices = path.map(toMeters);
  if (vertices.length === 1) return Math.hypot(...vertices[0]!);
  let best = Infinity;
  for (let i = 1; i < vertices.length; i++) {
    const [ax, ay] = vertices[i - 1]!;
    const [bx, by] = vertices[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
