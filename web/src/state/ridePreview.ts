/**
 * The ride preview as a re-timeable clock: progress is `fromMeters` plus the distance
 * covered at `metersPerSecond` since `startedAt` (performance.now time). Changing
 * speed or camera, pausing and resuming each fold the progress so far into
 * `fromMeters` and restart the clock, so the rider never jumps.
 *
 * Speed is a pace on screen, not a share of the route: 1× moves the map at the same
 * on-screen rate on every route and in every camera preset. Ground speed therefore
 * doubles for each zoom level the preset is further out (PACE_AT_ZOOM_16 × 2^(16 − zoom)),
 * so a long route takes longer instead of racing by. 1× on Street is about 90 m/s, the
 * pace a 4 km route had when 1× meant "the whole route in 45 s". A resume waits
 * RESUME_LEAD_IN_MS while the camera glides back from wherever the rider looked around.
 */
export const PREVIEW_LEAD_IN_MS = 1400;
export const RESUME_LEAD_IN_MS = 900;
const PACE_AT_ZOOM_16 = 120;

export type PreviewCamera = "close" | "street" | "wide";

export const PREVIEW_CAMERAS: Record<PreviewCamera, { readonly zoom: number; readonly pitch: number }> = {
  close: { zoom: 17.6, pitch: 72 },
  street: { zoom: 16.4, pitch: 66 },
  wide: { zoom: 14.8, pitch: 50 },
};

export interface RidePreview {
  readonly routeId: string;
  readonly startedAt: number;
  readonly metersPerSecond: number;
  readonly fromMeters: number;
  readonly paused: boolean;
}

export const previewMetersPerSecond = (camera: PreviewCamera, multiplier: number) =>
  PACE_AT_ZOOM_16 * 2 ** (16 - PREVIEW_CAMERAS[camera].zoom) * multiplier;

export const startPreview = (routeId: string, metersPerSecond: number, now: number): RidePreview => ({
  routeId,
  startedAt: now + PREVIEW_LEAD_IN_MS,
  metersPerSecond,
  fromMeters: 0,
  paused: false,
});

export const previewMetersAt = (preview: RidePreview, now: number) =>
  preview.fromMeters + (preview.paused ? 0 : Math.max(0, ((now - preview.startedAt) / 1000) * preview.metersPerSecond));

export const retimePreview = (preview: RidePreview, metersPerSecond: number, now: number): RidePreview => ({
  ...preview,
  fromMeters: previewMetersAt(preview, now),
  startedAt: Math.max(now, preview.startedAt),
  metersPerSecond,
});

export const togglePreviewPause = (preview: RidePreview, now: number): RidePreview =>
  preview.paused
    ? { ...preview, paused: false, startedAt: now + RESUME_LEAD_IN_MS }
    : { ...retimePreview(preview, preview.metersPerSecond, now), paused: true };
