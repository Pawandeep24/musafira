import type { LngLat, Route } from "@/api/types";

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** A route's full polyline with cumulative distances, for animation and camera paths. */
export interface Track {
  readonly points: readonly LngLat[];
  readonly cumulative: readonly number[];
  readonly total: number;
}

export function trackOf(route: Route): Track {
  const points: LngLat[] = [];
  for (const segment of route.segments) points.push(...(points.length ? segment.path.slice(1) : segment.path));
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1]! + haversine(points[i - 1]!, points[i]!));
  return { points, cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
}

function indexAt(track: Track, meters: number): number {
  let low = 0;
  let high = Math.max(0, track.points.length - 2);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (track.cumulative[mid]! <= meters) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function pointAt(track: Track, meters: number): LngLat {
  const m = Math.min(track.total, Math.max(0, meters));
  const i = indexAt(track, m);
  const a = track.points[i]!;
  const b = track.points[i + 1] ?? a;
  const span = track.cumulative[i + 1]! - track.cumulative[i]! || 1;
  const t = (m - track.cumulative[i]!) / span;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function sliceTrack(track: Track, from: number, to: number): LngLat[] {
  const start = Math.max(0, from);
  const end = Math.min(track.total, to);
  if (end <= start) return [];
  const inner = track.points.filter((_, i) => track.cumulative[i]! > start && track.cumulative[i]! < end);
  return [pointAt(track, start), ...inner, pointAt(track, end)];
}
