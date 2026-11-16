import type { PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LngLatBounds, Map as MapLibreMap, setWorkerUrl, type IControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useMemo, useRef, useState } from "react";
import type { City, ItineraryStop, LngLat, Route, Stop, TripReport } from "../api/types";
import { CATEGORY_LABEL } from "../lib/colors";
import { formatClock } from "../lib/format";
import { reportAge, reportSummary } from "../lib/reports";
import { bearing, pointAt, trackOf, type Track } from "../lib/track";
import { PREVIEW_LEAD_IN_MS, previewMetersAt, type RidePreview } from "../state/ridePreview";
import type { GridDot } from "./gridDots";
import { midnightStyle } from "./mapStyle";
import { sceneLayers, type TripScene } from "./sceneLayers";

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
  searchId?: string;
  selectedId?: string;
  from?: LngLat;
  to?: LngLat;
  reportPoint?: LngLat;
  lights?: readonly GridDot[];
  signal?: readonly GridDot[];
  preview?: RidePreview;
  insets: Insets;
  onSelectRoute(id: string): void;
  onPickPoint(point: LngLat): void;
  onTapPoint?(point: LngLat): void;
  onPreviewEnd(): void;
}

type Hover = { x: number; y: number } & ({ stop: Stop } | { report: TripReport } | { tripStop: ItineraryStop });

// MapLibre derives its worker path from import.meta.url, which bundling breaks.
setWorkerUrl(workerUrl);

const RIDE_CAMERA = { zoom: 16.4, pitch: 66 } as const;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
// Web Mercator ground resolution at zoom 0 for MapLibre's 512 px tiles.
const EQUATOR_METERS_PER_PIXEL = 78_271.517;
const REPORTS_RISE_DELAY_MS = 500;
const REPORTS_RISE_MS = 1100;
const ridePadding = (map: MapLibreMap) => ({ ...NO_PADDING, top: map.getContainer().clientHeight * 0.36 });

const lerpAngle = (from: number, to: number, t: number) => from + ((((to - from) % 360) + 540) % 360 - 180) * t;

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

  useEffect(() => {
    const center = latest.current.city?.center ?? [73.8567, 18.5204];
    const map = new MapLibreMap({
      container: container.current!,
      style: midnightStyle,
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
        } else if (now >= p.preview.startedAt) {
          const here = pointAt(track, previewMeters);
          smoothBearing = lerpAngle(smoothBearing, bearing(here, pointAt(track, previewMeters + 170)), 0.05);
          map.jumpTo({ ...RIDE_CAMERA, center: here, bearing: smoothBearing, padding: ridePadding(map) });
        }
      } else {
        smoothBearing = map.getBearing();
      }

      const metersPerPixel = (EQUATOR_METERS_PER_PIXEL * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();
      overlay.setProps({
        layers: sceneLayers({
          routes: p.routes,
          reports: p.reports,
          ...(p.trip ? { trip: p.trip } : {}),
          metersPerPixel,
          reportsRise: (now - reportsShownAt.current - REPORTS_RISE_DELAY_MS) / REPORTS_RISE_MS,
          ...(selected ? { selected } : {}),
          tracks: tracksRef.current,
          ...(p.from ? { from: p.from } : {}),
          ...(p.to ? { to: p.to } : {}),
          ...(p.reportPoint ? { reportPoint: p.reportPoint } : {}),
          ...(p.lights ? { lights: p.lights } : {}),
          ...(p.signal ? { signal: p.signal } : {}),
          ...(previewMeters !== undefined ? { previewMeters } : {}),
          timeMs: now,
          onSelectRoute: (id) => latest.current.onSelectRoute(id),
          onHoverStop: (info: PickingInfo<Stop>) => setHover(info.object ? { stop: info.object, x: info.x, y: info.y } : null),
          onHoverReport: (info: PickingInfo<TripReport>) => setHover(info.object ? { report: info.object, x: info.x, y: info.y } : null),
          onHoverTripStop: (info: PickingInfo<ItineraryStop>) => setHover(info.object ? { tripStop: info.object, x: info.x, y: info.y } : null),
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
      ...RIDE_CAMERA,
      center: track.points[0]!,
      bearing: bearing(track.points[0]!, pointAt(track, 170)),
      padding: ridePadding(map),
      duration: PREVIEW_LEAD_IN_MS,
      essential: true,
    });
  }, [props.preview?.routeId]);

  useEffect(() => {
    const map = mapRef.current;
    const point = props.reportPoint;
    if (map && point && !map.getBounds().contains(point)) map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 900 });
  }, [props.reportPoint]);

  const offset = props.city?.utcOffsetMinutes ?? 330;
  const selectedId = props.selectedId ?? props.routes[0]?.id;
  return (
    <div className="map-root">
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
