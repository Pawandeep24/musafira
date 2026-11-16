/**
 * Builds the deck.gl layer stack for one animation frame.
 *
 * Stack, bottom to top: data dot-matrices → other routes (ghosts) → selected route
 * (dark casing, wide translucent glow, per-segment safety colour core) → pulsing
 * dark stretches and dead zones → two "comets" of light flowing along the route →
 * stops → rider-report pillars → washroom pins (lilac Safe Stops, larger; blue public
 * toilets; amber fuel stations) → booked ride (the other option dim, the ride as a white
 * line with glow, numbered violet safety checkpoints) → start/end beacons → the marked spot
 * (a report, a washroom search, a shop being listed) → ride-preview puck → driver puck
 * (teal, rose and faster when off route).
 *
 * A day trip replaces the routes with its own layers: legs as arcs (rose when ridden
 * after dark), numbered stops (amber to eat, teal to see) and a beacon at the base.
 *
 * Report pillars are sized in screen pixels: radius and height are multiplied by
 * the map's metres-per-pixel each frame, so they read the same at city and street
 * zoom. They rise over ~1 s when a search lands (`reportsRise` 0..1). A pillar is
 * bright when its report affects the selected route, dim when it is only nearby.
 *
 * Layers are recreated every frame (deck.gl diffs them cheaply by id); only the
 * animated ones change their data, the rest keep stable data references.
 */
import type { Layer, PickingInfo } from "@deck.gl/core";
import { ArcLayer, ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { ItineraryLeg, ItineraryStop, LngLat, Route, Segment, Stop, Stretch, TripReport, Washroom } from "../api/types";
import { CATEGORY_RGB, safetyRgba, type Rgba } from "../lib/colors";
import { REPORT_META, TONE_RGB } from "../lib/reports";
import { SOURCE_RGB } from "../lib/safeStops";
import { pointAt, sliceTrack, type Track } from "../lib/track";
import type { GridDot } from "./gridDots";

export interface TripScene {
  readonly base: LngLat;
  readonly stops: readonly ItineraryStop[];
  readonly legs: readonly ItineraryLeg[];
}

export interface RideScene {
  /** Changes when the camera should frame the ride again (a new quote option or booking). */
  readonly key: string;
  readonly path: LngLat[];
  readonly alternative?: LngLat[];
  readonly checkpoints: readonly LngLat[];
  readonly driver?: LngLat;
  readonly offRoute: boolean;
  /** How long the driver puck glides between two reported positions. */
  readonly tweenMs: number;
}

export interface SceneInput {
  readonly routes: readonly Route[];
  readonly trip?: TripScene;
  readonly ride?: RideScene;
  readonly rideDriver?: LngLat;
  readonly selected?: Route;
  readonly tracks: ReadonlyMap<string, Track>;
  readonly from?: LngLat;
  readonly to?: LngLat;
  readonly reports: readonly TripReport[];
  readonly markedPoint?: LngLat;
  readonly washrooms?: readonly Washroom[];
  readonly lights?: readonly GridDot[];
  readonly signal?: readonly GridDot[];
  readonly previewMeters?: number;
  readonly timeMs: number;
  readonly metersPerPixel: number;
  readonly reportsRise: number;
  onSelectRoute(id: string): void;
  onHoverStop(info: PickingInfo<Stop>): void;
  onHoverReport(info: PickingInfo<TripReport>): void;
  onHoverTripStop(info: PickingInfo<ItineraryStop>): void;
  onHoverWashroom(info: PickingInfo<Washroom>): void;
}

const EAT_RGB = [255, 196, 87] as const;
const SEE_RGB = [46, 242, 200] as const;
const LEG_RGB = [168, 140, 255] as const;
const DARK_LEG_RGB = [255, 61, 110] as const;
const RIDE_RGB = [236, 244, 255] as const;
const CHECKPOINT_RGB = [139, 124, 255] as const;
const DRIVER_RGB = [46, 242, 200] as const;
const OFF_ROUTE_RGB = [255, 61, 110] as const;
const EATERY_KINDS: ReadonlySet<string> = new Set(["restaurant", "cafe", "fast_food"]);

const PILLAR_RADIUS_PX = 6;
const PILLAR_BASE_PX = 34;
const PILLAR_PER_REPORT_PX = 12;
const MAX_PILLAR_REPORTS = 5;

const COMET_PERIOD_MS = 6500;
const COMET_PIECES = 16;
const COMET_PIECE_METERS = 45;
const pulse = (timeMs: number, periodMs: number) => 0.5 + 0.5 * Math.sin((timeMs / periodMs) * Math.PI * 2);

function cometPieces(track: Track, head: number): { path: LngLat[]; color: Rgba; width: number }[] {
  return Array.from({ length: COMET_PIECES }, (_, i) => {
    const fade = 1 - i / COMET_PIECES;
    return {
      path: sliceTrack(track, head - (i + 1) * COMET_PIECE_METERS, head - i * COMET_PIECE_METERS),
      color: [225, 255, 250, Math.round(235 * fade * fade)] as Rgba,
      width: 2 + 4 * fade,
    };
  }).filter((piece) => piece.path.length > 1);
}

function dotLayers(id: string, dots: readonly GridDot[] | undefined, dimmed: boolean) {
  if (!dots) return [];
  const dim = dimmed ? 0.4 : 1;
  const layer = (suffix: string, grow: number, alphaScale: number, minPixels: number, maxPixels: number) =>
    new ScatterplotLayer<GridDot>({
      id: `${id}-${suffix}`,
      data: dots,
      getPosition: (d) => d.position,
      getRadius: (d) => d.radius * grow,
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], d.color[3] * alphaScale * dim],
      radiusUnits: "meters",
      radiusMinPixels: minPixels,
      radiusMaxPixels: maxPixels,
      updateTriggers: { getFillColor: dim },
    });
  return [layer("bloom", 2.4, 0.07, 0, 22), layer("core", 1, 1, 1, 8)];
}

function puck(id: string, position: LngLat, rgb: readonly [number, number, number], timeMs: number, periodMs = 1600) {
  const breathe = pulse(timeMs, periodMs);
  return new ScatterplotLayer<{ radius: number; color: Rgba; line?: Rgba }>({
    id,
    data: [
      { radius: 30 + 8 * breathe, color: [...rgb, Math.round(40 + 30 * breathe)] },
      { radius: 14, color: [...rgb, 255], line: [255, 255, 255, 255] },
    ],
    getPosition: () => position,
    getRadius: (d) => d.radius,
    getFillColor: (d) => d.color,
    getLineColor: (d) => d.line ?? [0, 0, 0, 0],
    stroked: true,
    lineWidthUnits: "pixels",
    getLineWidth: 3,
    radiusUnits: "pixels",
    updateTriggers: { getPosition: position.join(","), getRadius: breathe, getFillColor: `${rgb.join(",")}:${breathe}` },
  });
}

function stretchLayer(id: string, stretches: readonly Stretch[], rgb: readonly [number, number, number], alpha: number, width: number) {
  return new PathLayer<Stretch>({
    id,
    data: stretches,
    getPath: (s) => s.path,
    getColor: [...rgb, alpha],
    getWidth: width,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    updateTriggers: { getColor: alpha },
  });
}

function beacon(id: string, point: LngLat | undefined, rgb: readonly [number, number, number], timeMs: number) {
  if (!point) return [];
  const phase = (timeMs % 2200) / 2200;
  return [
    new ScatterplotLayer<LngLat>({
      id: `${id}-ring`,
      data: [point],
      getPosition: (p) => p,
      getRadius: 8 + 22 * phase,
      radiusUnits: "pixels",
      filled: false,
      stroked: true,
      getLineColor: [...rgb, Math.round(200 * (1 - phase))],
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      updateTriggers: { getRadius: phase, getLineColor: phase },
    }),
    new ScatterplotLayer<LngLat>({
      id: `${id}-core`,
      data: [point],
      getPosition: (p) => p,
      getRadius: 7,
      radiusUnits: "pixels",
      getFillColor: [...rgb, 255],
      stroked: true,
      getLineColor: [6, 8, 15, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 3,
    }),
  ];
}

function tripLayers(trip: TripScene, timeMs: number, onHover: SceneInput["onHoverTripStop"]): Layer[] {
  const glow = pulse(timeMs, 1800);
  const stopRgb = (s: ItineraryStop) => (EATERY_KINDS.has(s.kind) ? EAT_RGB : SEE_RGB);
  return [
    new ArcLayer<ItineraryLeg>({
      id: "trip-legs",
      data: trip.legs,
      getSourcePosition: (l) => l.from,
      getTargetPosition: (l) => l.to,
      getSourceColor: (l) => [...(l.dark ? DARK_LEG_RGB : LEG_RGB), 230],
      getTargetColor: (l) => [...(l.dark ? DARK_LEG_RGB : SEE_RGB), 230],
      getHeight: 0.35,
      getWidth: 3,
      widthUnits: "pixels",
    }),
    new ScatterplotLayer<ItineraryStop>({
      id: "trip-stop-halos",
      data: trip.stops,
      getPosition: (s) => s.point,
      getRadius: 19 + 5 * glow,
      radiusUnits: "pixels",
      getFillColor: (s) => [...stopRgb(s), 50],
      updateTriggers: { getRadius: glow },
    }),
    new ScatterplotLayer<ItineraryStop>({
      id: "trip-stops",
      data: trip.stops,
      getPosition: (s) => s.point,
      getRadius: 11,
      radiusUnits: "pixels",
      getFillColor: (s) => [...stopRgb(s), 255],
      stroked: true,
      getLineColor: [6, 8, 15, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      pickable: true,
      onHover,
    }),
    new TextLayer<ItineraryStop>({
      id: "trip-stop-numbers",
      data: trip.stops,
      getPosition: (s) => s.point,
      getText: (_, { index }) => String(index + 1),
      getSize: 12,
      getColor: [6, 8, 15, 255],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 700,
      characterSet: "0123456789",
    }),
    ...beacon("trip-base", trip.base, LEG_RGB, timeMs),
  ];
}

function rideLayers(ride: RideScene, timeMs: number): Layer[] {
  const glow = pulse(timeMs, 1800);
  const line = (id: string, path: LngLat[] | undefined, color: Rgba, width: number) =>
    new PathLayer<LngLat[]>({
      id,
      data: path ? [path] : [],
      getPath: (p) => p,
      getColor: color,
      getWidth: width,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
    });
  return [
    line("ride-alternative", ride.alternative, [150, 160, 200, 110], 4),
    line("ride-glow", ride.path, [...RIDE_RGB, 45], 16),
    line("ride-path", ride.path, [...RIDE_RGB, 235], 3),
    new ScatterplotLayer<LngLat>({
      id: "checkpoint-halos",
      data: ride.checkpoints,
      getPosition: (p) => p,
      getRadius: 17 + 6 * glow,
      radiusUnits: "pixels",
      getFillColor: [...CHECKPOINT_RGB, 55],
      updateTriggers: { getRadius: glow },
    }),
    new ScatterplotLayer<LngLat>({
      id: "checkpoints",
      data: ride.checkpoints,
      getPosition: (p) => p,
      getRadius: 11,
      radiusUnits: "pixels",
      getFillColor: [...CHECKPOINT_RGB, 255],
      stroked: true,
      getLineColor: [255, 255, 255, 255],
      lineWidthUnits: "pixels",
      getLineWidth: 2,
    }),
    new TextLayer<LngLat>({
      id: "checkpoint-numbers",
      data: ride.checkpoints,
      getPosition: (p) => p,
      getText: (_, { index }) => String(index + 1),
      getSize: 12,
      getColor: [255, 255, 255, 255],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 700,
      characterSet: "0123456789",
    }),
  ];
}

export function sceneLayers(input: SceneInput): Layer[] {
  const { selected, tracks, timeMs } = input;
  const track = selected ? tracks.get(selected.id) : undefined;
  const others = input.routes.filter((r) => r.id !== selected?.id);
  const scoreKey = selected ? `${selected.id}:${selected.score}:${selected.segments.length}` : "";
  const visibleStops = selected?.stops.filter((s) => s.kinds.includes("safety") || s.open) ?? [];
  const openStops = visibleStops.filter((s) => s.open);
  const affectsSelected = (r: TripReport) => Boolean(selected && r.routeIds.includes(selected.id));
  const reportRgba = (r: TripReport, bright: number, dim: number): Rgba => [
    ...TONE_RGB[REPORT_META[r.category].tone],
    affectsSelected(r) ? bright : dim,
  ];
  const rise = 1 - (1 - Math.min(1, Math.max(0, input.reportsRise))) ** 3;

  const layers: (Layer | null)[] = [
    ...(input.previewMeters === undefined
      ? [...dotLayers("night-lights", input.lights, Boolean(selected)), ...dotLayers("signal", input.signal, Boolean(selected))]
      : []),

    new PathLayer<Route>({
      id: "routes-ghost",
      data: others,
      getPath: (r) => tracks.get(r.id)?.points.slice() ?? [],
      getColor: [150, 140, 255, 90],
      getWidth: 6,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [190, 180, 255, 160],
      onClick: ({ object }) => object && input.onSelectRoute(object.id),
    }),

    ...(selected
      ? [
          new PathLayer<LngLat[]>({
            id: "route-casing",
            data: [track?.points.slice() ?? []],
            getPath: (p) => p,
            getColor: [4, 6, 12, 230],
            getWidth: 11,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
          }),
          new PathLayer<Segment>({
            id: "route-glow",
            data: selected.segments,
            getPath: (s) => s.path,
            getColor: (s) => safetyRgba(s.score, 55),
            getWidth: 26,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            updateTriggers: { getColor: scoreKey },
          }),
          new PathLayer<Segment>({
            id: "route-core",
            data: selected.segments,
            getPath: (s) => s.path,
            getColor: (s) => safetyRgba(s.score),
            getWidth: 6,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            updateTriggers: { getColor: scoreKey },
          }),
          stretchLayer("dark-stretches", selected.darkStretches, [255, 61, 110], Math.round(60 + 120 * pulse(timeMs, 1400)), 30),
          stretchLayer("dead-zones", selected.deadZones, [170, 120, 255], Math.round(50 + 110 * pulse(timeMs + 500, 1800)), 22),
        ]
      : []),

    ...(track && track.total > 0 && input.previewMeters === undefined
      ? [0, 0.5].map(
          (offset) =>
            new PathLayer<{ path: LngLat[]; color: Rgba; width: number }>({
              id: `comet-${offset}`,
              data: cometPieces(track, ((timeMs / COMET_PERIOD_MS + offset) % 1) * (track.total + COMET_PIECES * COMET_PIECE_METERS)),
              getPath: (p) => p.path,
              getColor: (p) => p.color,
              getWidth: (p) => p.width,
              widthUnits: "pixels",
              capRounded: true,
            }),
        )
      : []),

    new ScatterplotLayer<Stop>({
      id: "stop-halos",
      data: openStops,
      getPosition: (s) => s.point,
      getRadius: 13,
      radiusUnits: "pixels",
      getFillColor: (s) => [...CATEGORY_RGB[s.category], 40],
    }),
    new ScatterplotLayer<Stop>({
      id: "stops",
      data: visibleStops,
      getPosition: (s) => s.point,
      getRadius: (s) => (s.open ? 6 : 4),
      radiusUnits: "pixels",
      getFillColor: (s) => (s.open ? [...CATEGORY_RGB[s.category], 240] : [60, 68, 92, 220]),
      stroked: true,
      getLineColor: (s) => (s.open ? [255, 255, 255, 220] : [130, 140, 170, 160]),
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      pickable: true,
      onHover: input.onHoverStop,
    }),

    new ScatterplotLayer<TripReport>({
      id: "report-halos",
      data: input.reports,
      getPosition: (r) => r.point,
      getRadius: (r) => (affectsSelected(r) ? 18 : 11),
      radiusUnits: "pixels",
      getFillColor: (r) => reportRgba(r, 70, 25),
      updateTriggers: { getRadius: selected?.id, getFillColor: selected?.id },
    }),
    new ColumnLayer<TripReport>({
      id: "report-pillars",
      data: input.reports,
      diskResolution: 16,
      radius: PILLAR_RADIUS_PX * input.metersPerPixel,
      extruded: true,
      elevationScale: input.metersPerPixel * rise,
      getPosition: (r) => r.point,
      getElevation: (r) => PILLAR_BASE_PX + PILLAR_PER_REPORT_PX * Math.min(r.count, MAX_PILLAR_REPORTS),
      getFillColor: (r) => reportRgba(r, 240, 90),
      pickable: true,
      onHover: input.onHoverReport,
      updateTriggers: { getFillColor: selected?.id },
    }),

    new ScatterplotLayer<Washroom>({
      id: "washroom-halos",
      data: input.washrooms ?? [],
      getPosition: (w) => w.point,
      getRadius: (w) => (w.source === "safeStop" ? 20 : 13),
      radiusUnits: "pixels",
      getFillColor: (w) => [...SOURCE_RGB[w.source], 45],
    }),
    new ScatterplotLayer<Washroom>({
      id: "washrooms",
      data: input.washrooms ?? [],
      getPosition: (w) => w.point,
      getRadius: (w) => (w.source === "safeStop" ? 9 : 6),
      radiusUnits: "pixels",
      getFillColor: (w) => [...SOURCE_RGB[w.source], 245],
      stroked: true,
      getLineColor: [255, 255, 255, 230],
      lineWidthUnits: "pixels",
      getLineWidth: (w) => (w.source === "safeStop" ? 2.5 : 1.5),
      pickable: true,
      onHover: input.onHoverWashroom,
    }),

    ...(input.ride ? rideLayers(input.ride, timeMs) : []),
    ...(input.trip ? tripLayers(input.trip, timeMs, input.onHoverTripStop) : []),
    ...beacon("origin", input.from, [168, 140, 255], timeMs),
    ...beacon("destination", input.to, [46, 242, 200], timeMs + 1100),
    ...beacon("marked-spot", input.markedPoint, [255, 196, 87], timeMs + 500),
  ];

  if (track && input.previewMeters !== undefined) {
    const position = pointAt(track, input.previewMeters);
    const segment = selected?.segments.find((s) => s.endMeters >= input.previewMeters!);
    const rgb = safetyRgba(segment?.score ?? null);
    layers.push(
      new PathLayer<LngLat[]>({
        id: "preview-trail",
        data: [sliceTrack(track, input.previewMeters - 400, input.previewMeters)],
        getPath: (p) => p,
        getColor: [235, 255, 250, 200],
        getWidth: 5,
        widthUnits: "pixels",
        capRounded: true,
      }),
      puck("puck", position, [rgb[0], rgb[1], rgb[2]], timeMs),
    );
  }

  if (input.ride && input.rideDriver) {
    const off = input.ride.offRoute;
    layers.push(puck("driver", input.rideDriver, off ? OFF_ROUTE_RGB : DRIVER_RGB, timeMs, off ? 700 : 1600));
  }

  return layers.filter((layer): layer is Layer => layer !== null);
}
