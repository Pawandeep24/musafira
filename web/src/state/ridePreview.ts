export const PREVIEW_LEAD_IN_MS = 1400;
export const PREVIEW_SECONDS = 45;

/** A ride preview is a clock: progress is `fromMeters` plus distance covered since `startedAt` (performance.now time). */
export interface RidePreview {
  readonly routeId: string;
  readonly startedAt: number;
  readonly metersPerSecond: number;
  readonly fromMeters: number;
}

export const startPreview = (routeId: string, routeMeters: number, now: number): RidePreview => ({
  routeId,
  startedAt: now + PREVIEW_LEAD_IN_MS,
  metersPerSecond: routeMeters / PREVIEW_SECONDS,
  fromMeters: 0,
});

export const previewMetersAt = (preview: RidePreview, now: number) =>
  preview.fromMeters + Math.max(0, ((now - preview.startedAt) / 1000) * preview.metersPerSecond);

export const retimePreview = (preview: RidePreview, metersPerSecond: number, now: number): RidePreview => ({
  ...preview,
  fromMeters: previewMetersAt(preview, now),
  startedAt: Math.max(now, preview.startedAt),
  metersPerSecond,
});
