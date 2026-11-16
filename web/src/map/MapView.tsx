/**
 * The MapLibre map with the deck.gl scene on top, redrawn every animation frame.
 *
 * Ride preview camera: each frame jumps to the rider's point, turning the bearing
 * smoothly towards the road 170 m ahead. On a preset change (Close, Street, Wide) the
 * zoom and pitch ease 8% of the way per frame until they reach it; after that the
 * rider's own pinch or scroll zoom is kept, clamped to 13..19. Presets ease inside the
 * frame loop because every `jumpTo` would cancel a MapLibre `easeTo`. Zoom gestures
 * anchor on the rider while following so the camera doesn't jump back each frame.
 * Paused, the camera stops following and gestures are free to look around; a preset
 * picked meanwhile eases in place, and resuming flies back to the rider during the
 * clock's resume lead-in.
 */
import type { PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LngLatBounds, Map as MapLibreMap, setWorkerUrl, type IControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useMemo, useRef, useState } from "react";
import type { City, ItineraryStop, LngLat, Route, Stop, TripReport, Washroom } from "../api/types";
import { CATEGORY_LABEL } from "../lib/colors";
import { formatClock, formatDistance } from "../lib/format";
import { reportAge, reportSummary } from "../lib/reports";
import { SOURCE_LABEL, washroomName } from "../lib/safeStops";
import { bearing, pointAt, trackOf, type Track } from "../lib/track";
import { PREVIEW_CAMERAS, PREVIEW_LEAD_IN_MS, previewMetersAt, RESUME_LEAD_IN_MS, type PreviewCamera, type RidePreview } from "../state/ridePreview";
import type { MapTheme } from "../state/useMapTheme";
import type { GridDot } from "./gridDots";
import { BASEMAPS } from "./mapStyle";
import { sceneLayers, type RideScene, type TripScene } from "./sceneLayers";

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface Props {
  city?: City;
  routes: readonly Route[];
  reports: readonly TripReport[];
  trip?: TripScene;
  ride?: RideScene;
  searchId?: string;
  selectedId?: string;
  from?: LngLat;
  to?: LngLat;
  markedPoint?: LngLat;
  washrooms?: readonly Washroom[];
  lights?: readonly GridDot[];
  signal?: readonly GridDot[];
  preview?: RidePreview;
  previewCamera: PreviewCamera;
  theme: MapTheme;
  insets: Insets;
  onSelectRoute(id: string): void;
  onPickPoint(point: LngLat): void;
  onTapPoint?(point: LngLat): void;
  onPreviewEnd(): void;
}

type Hover = { x: number; y: number } & ({ stop: Stop } | { report: TripReport } | { tripStop: ItineraryStop } | { washroom: Washroom });

// MapLibre derives its worker path from import.meta.url, which bundling breaks.
setWorkerUrl(workerUrl);

const PREVIEW_MIN_ZOOM = 13;
const PREVIEW_MAX_ZOOM = 19;
const CAMERA_EASE = 0.08;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
// Web Mercator ground resolution at zoom 0 for MapLibre's 512 px tiles.
const EQUATOR_METERS_PER_PIXEL = 78_271.517;
const REPORTS_RISE_DELAY_MS = 500;
const REPORTS_RISE_MS = 1100;
const FRAMED_WASHROOMS = 6;
const ridePadding = (map: MapLibreMap) => ({ ...NO_PADDING, top: map.getContainer().clientHeight * 0.36 });

const lerpAngle = (from: number, to: number, t: number) => from + ((((to - from) % 360) + 540) % 360 - 180) * t;

interface Glide {
  readonly from: LngLat;
  readonly to: LngLat;
  readonly startedAt: number;
}

function glideAt({ from, to, startedAt }: Glide, now: number, durationMs: number): LngLat {
  const t = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [hover, setHover] = useState<Hover | null>(null);

  const tracks = useMemo(() => new Map<string, Track>(props.routes.map((r) => [r.id, trackOf(r)])), [props.routes]);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const reportsShownAt = useRef(0);
  const driverGlide = useRef<Glide | null>(null);

  useEffect(() => {
    const center = latest.current.city?.center ?? [73.8567, 18.5204];
    const map = new MapLibreMap({
      container: container.current!,
      style: BASEMAPS[latest.current.theme],
      center,
      zoom: 10.4,
      pitch: 0,
      bearing: 0,
      maxPitch: 75,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as IControl);
    map.on("load", () => map.flyTo({ center, zoom: 12.4, pitch: 58, bearing: -18, duration: 3200, essential: true }));
    map.on("contextmenu", (e) => latest.current.onPickPoint([e.lngLat.lng, e.lngLat.lat]));
    map.on("click", (e) => latest.current.onTapPoint?.([e.lngLat.lng, e.lngLat.lat]));

    let smoothBearing = map.getBearing();
    let framedCamera: PreviewCamera | undefined;
    let settling = false;
    map.on("zoomstart", (e) => {
      if (e.originalEvent) settling = false;
    });
    let frame = 0;
    const tick = (now: number) => {
      const p = latest.current;
      const selected = p.routes.find((r) => r.id === p.selectedId) ?? p.routes[0];
      const track = selected ? tracksRef.current.get(selected.id) : undefined;
      let previewMeters: number | undefined;

      if (p.preview && track && selected?.id === p.preview.routeId) {
        previewMeters = previewMetersAt(p.preview, now);
        if (previewMeters >= track.total) {
          p.onPreviewEnd();
        } else if (p.preview.paused || now < p.preview.startedAt) {
          smoothBearing = map.getBearing();
        } else {
          const here = pointAt(track, previewMeters);
          smoothBearing = lerpAngle(smoothBearing, bearing(here, pointAt(track, previewMeters + 170)), 0.05);
          const goal = PREVIEW_CAMERAS[p.previewCamera];
          if (p.previewCamera !== framedCamera) {
            framedCamera = p.previewCamera;
            settling = true;
          }
          const zoom = map.getZoom();
          const nextZoom = settling ? zoom + (goal.zoom - zoom) * CAMERA_EASE : Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, zoom));
          if (Math.abs(goal.zoom - nextZoom) < 0.01) settling = false;
          const pitch = map.getPitch() + (goal.pitch - map.getPitch()) * CAMERA_EASE;
          map.jumpTo({ zoom: nextZoom, pitch, center: here, bearing: smoothBearing, padding: ridePadding(map) });
        }
      } else {
        smoothBearing = map.getBearing();
        framedCamera = undefined;
      }

      const metersPerPixel = (EQUATOR_METERS_PER_PIXEL * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();
      const glide = driverGlide.current;
      overlay.setProps({
        layers: sceneLayers({
          routes: p.routes,
          reports: p.reports,
          ...(p.trip ? { trip: p.trip } : {}),
          ...(p.ride ? { ride: p.ride } : {}),
          ...(p.ride && glide ? { rideDriver: glideAt(glide, now, p.ride.tweenMs) } : {}),
          metersPerPixel,
          reportsRise: (now - reportsShownAt.current - REPORTS_RISE_DELAY_MS) / REPORTS_RISE_MS,
          ...(selected ? { selected } : {}),
          tracks: tracksRef.current,
          ...(p.from ? { from: p.from } : {}),
          ...(p.to ? { to: p.to } : {}),
          ...(p.markedPoint ? { markedPoint: p.markedPoint } : {}),
          ...(p.washrooms ? { washrooms: p.washrooms } : {}),
          ...(p.lights ? { lights: p.lights } : {}),
          ...(p.signal ? { signal: p.signal } : {}),
          ...(previewMeters !== undefined ? { previewMeters } : {}),
          theme: p.theme,
          timeMs: now,
          onSelectRoute: (id) => latest.current.onSelectRoute(id),
          onHoverStop: (info: PickingInfo<Stop>) => setHover(info.object ? { stop: info.object, x: info.x, y: info.y } : null),
          onHoverReport: (info: PickingInfo<TripReport>) => setHover(info.object ? { report: info.object, x: info.x, y: info.y } : null),
          onHoverTripStop: (info: PickingInfo<ItineraryStop>) => setHover(info.object ? { tripStop: info.object, x: info.x, y: info.y } : null),
          onHoverWashroom: (info: PickingInfo<Washroom>) => setHover(info.object ? { washroom: info.object, x: info.x, y: info.y } : null),
        }),
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.city || props.routes.length) return;
    map.flyTo({ center: props.city.center, zoom: 12.4, pitch: 58, bearing: -18, duration: 2200 });
  }, [props.city?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.preview) return;
    const points = [...tracks.values()].flatMap((t) => t.points);
    if (points.length === 0) return;
    const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
    map.setPadding(NO_PADDING);
    map.fitBounds(bounds, { padding: props.insets, pitch: 50, bearing: -12, duration: 1600, maxZoom: 15.5 });
  }, [props.searchId, props.preview === undefined]);

  useEffect(() => {
    reportsShownAt.current = performance.now();
  }, [props.searchId]);

  useEffect(() => {
    const map = mapRef.current;
    const trip = props.trip;
    if (!map || !trip) return;
    const bounds = trip.stops.reduce((b, s) => b.extend(s.point), new LngLatBounds(trip.base, trip.base));
    map.setPadding(NO_PADDING);
    map.fitBounds(bounds, { padding: props.insets, pitch: 52, bearing: -14, duration: 1600, maxZoom: 15 });
  }, [props.trip]);

  useEffect(() => {
    const map = mapRef.current;
    const track = props.preview ? tracks.get(props.preview.routeId) : undefined;
    if (!map || !track) return;
    map.flyTo({
      ...PREVIEW_CAMERAS[props.previewCamera],
      center: track.points[0]!,
      bearing: bearing(track.points[0]!, pointAt(track, 170)),
      padding: ridePadding(map),
      duration: PREVIEW_LEAD_IN_MS,
      essential: true,
    });
  }, [props.preview?.routeId]);

  const paused = props.preview?.paused ?? false;
  const wasPaused = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const preview = latest.current.preview;
    const resumed = wasPaused.current && !paused;
    wasPaused.current = paused;
    const track = preview ? tracks.get(preview.routeId) : undefined;
    if (!map || !preview || !track || !resumed) return;
    const here = pointAt(track, preview.fromMeters);
    map.flyTo({
      ...PREVIEW_CAMERAS[latest.current.previewCamera],
      center: here,
      bearing: bearing(here, pointAt(track, preview.fromMeters + 170)),
      padding: ridePadding(map),
      duration: RESUME_LEAD_IN_MS,
      essential: true,
    });
  }, [paused]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && latest.current.preview?.paused) map.easeTo({ ...PREVIEW_CAMERAS[props.previewCamera], duration: 600 });
  }, [props.previewCamera]);

  const following = props.preview !== undefined && !paused;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const around = following ? { around: "center" as const } : undefined;
    map.scrollZoom.disable();
    map.scrollZoom.enable(around);
    map.touchZoomRotate.enable(around);
  }, [following]);

  const shownTheme = useRef(props.theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownTheme.current === props.theme) return;
    shownTheme.current = props.theme;
    map.setStyle(BASEMAPS[props.theme], { diff: true });
  }, [props.theme]);

  const [driverLon, driverLat] = props.ride?.driver ?? [];
  useEffect(() => {
    if (driverLon === undefined || driverLat === undefined) {
      driverGlide.current = null;
      return;
    }
    const now = performance.now();
    const current = driverGlide.current;
    const from = current ? glideAt(current, now, latest.current.ride?.tweenMs ?? 1000) : ([driverLon, driverLat] as LngLat);
    driverGlide.current = { from, to: [driverLon, driverLat], startedAt: now };
  }, [driverLon, driverLat]);

  useEffect(() => {
    const map = mapRef.current;
    const ride = props.ride;
    if (!map || !ride || ride.path.length < 2 || props.preview) return;
    const points = [...ride.path, ...(ride.alternative ?? [])];
    const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
    map.setPadding(NO_PADDING);
    map.fitBounds(bounds, { padding: props.insets, pitch: 48, bearing: -10, duration: 1400, maxZoom: 15.5 });
  }, [props.ride?.key]);

  useEffect(() => {
    const map = mapRef.current;
    const point = props.markedPoint;
    if (map && point && !map.getBounds().contains(point)) map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 900 });
  }, [props.markedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const point = props.markedPoint;
    const nearest = props.washrooms?.slice(0, FRAMED_WASHROOMS) ?? [];
    if (!map || !point || nearest.length === 0) return;
    const bounds = nearest.reduce((b, w) => b.extend(w.point), new LngLatBounds(point, point));
    map.setPadding(NO_PADDING);
    map.fitBounds(bounds, { padding: props.insets, pitch: 45, bearing: -10, duration: 1400, maxZoom: 16 });
  }, [props.washrooms]);

  const offset = props.city?.utcOffsetMinutes ?? 330;
  const selectedId = props.selectedId ?? props.routes[0]?.id;
  return (
    <div className={`map-root ${props.theme === "day" ? "is-day" : ""}`}>
      <div ref={container} className="map-canvas" />
      {hover && "report" in hover && (
        <div className="map-tooltip glass" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="map-tooltip__title">{reportSummary(hover.report.count, hover.report.category)}</div>
          <div className="map-tooltip__meta">Last reported {reportAge(hover.report.lastObservedAt, new Date(), offset)}</div>
          <div className="map-tooltip__state">
            {hover.report.routeIds.includes(selectedId ?? "") ? "Counted on this route" : "Near your trip, not counted on this route"}
          </div>
        </div>
      )}
      {hover && "tripStop" in hover && (
        <div className="map-tooltip glass" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="map-tooltip__title">{hover.tripStop.name}</div>
          <div className="map-tooltip__meta">
            {formatClock(hover.tripStop.arriveAt, offset)} to {formatClock(hover.tripStop.leaveAt, offset)}
            {hover.tripStop.area && ` · ${hover.tripStop.area}`}
          </div>
        </div>
      )}
      {hover && "washroom" in hover && (
        <div className="map-tooltip glass" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="map-tooltip__title">{washroomName(hover.washroom)}</div>
          <div className="map-tooltip__meta">
            {SOURCE_LABEL[hover.washroom.source]} · {formatDistance(hover.washroom.distanceMeters)} · {hover.washroom.rideMinutes} min ride
          </div>
          <div className="map-tooltip__state is-open">
            {hover.washroom.closesAt ? `Open · closes ${formatClock(hover.washroom.closesAt, offset)}` : "Open 24 hours"}
            {hover.washroom.estimated && <span className="hint"> · typical hours</span>}
          </div>
        </div>
      )}
      {hover && "stop" in hover && (
        <div className="map-tooltip glass" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="map-tooltip__title">{hover.stop.name ?? CATEGORY_LABEL[hover.stop.category]}</div>
          <div className="map-tooltip__meta">
            {CATEGORY_LABEL[hover.stop.category]} · you pass at {formatClock(hover.stop.arrival, offset)}
          </div>
          <div className={`map-tooltip__state ${hover.stop.open ? "is-open" : "is-closed"}`}>
            {hover.stop.open
              ? hover.stop.closesAt
                ? `Open · closes ${formatClock(hover.stop.closesAt, offset)}`
                : "Open 24 hours"
              : "Closed when you pass"}
            {hover.stop.estimated && <span className="hint"> · typical hours</span>}
          </div>
        </div>
      )}
    </div>
  );
}
