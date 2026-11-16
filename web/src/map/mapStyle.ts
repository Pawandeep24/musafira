import type { StyleSpecification } from "maplibre-gl";
import type { MapTheme } from "../state/useMapTheme";

const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]] as const;
const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];

const roadWidth = (base: number) =>
  ["interpolate", ["exponential", 1.5], ["zoom"], 10, base * 0.4, 14, base * 1.4, 18, base * 6] as unknown as number;

interface Palette {
  readonly background: string;
  readonly landcover: string;
  readonly park: string;
  readonly landuse: string;
  readonly water: string;
  readonly waterway: string;
  readonly roads: readonly [minor: string, mid: string, major: string];
  readonly rail: string;
  readonly buildings: readonly [low: string, mid: string, tall: string, tower: string];
  readonly labels: { readonly road: string; readonly neighbourhood: string; readonly city: string; readonly halo: string };
  readonly sky: { readonly sky: string; readonly horizon: string; readonly fog: string };
  readonly light: { readonly color: string; readonly intensity: number };
}

const NIGHT: Palette = {
  background: "#06080f",
  landcover: "#0a1513",
  park: "#0b1a17",
  landuse: "#0a0d17",
  water: "#061626",
  waterway: "#0b2640",
  roads: ["#141a2a", "#1b2338", "#242e4a"],
  rail: "#1a2033",
  buildings: ["#0e1322", "#151c33", "#1f2a4c", "#2b3a6b"],
  labels: { road: "#56617f", neighbourhood: "#6c7799", city: "#9aa6cc", halo: "#06080f" },
  sky: { sky: "#0b1024", horizon: "#22204a", fog: "#06080f" },
  light: { color: "#c4cdff", intensity: 0.32 },
};

const DAY: Palette = {
  background: "#e3e6ec",
  landcover: "#d3e2d2",
  park: "#c9dfc6",
  landuse: "#dde0e7",
  water: "#a9c8e6",
  waterway: "#93b9df",
  roads: ["#f4f6f9", "#ffffff", "#ffffff"],
  rail: "#bcc2cf",
  buildings: ["#d6dae3", "#cdd2dd", "#c1c8d6", "#b4bdcf"],
  labels: { road: "#687086", neighbourhood: "#737b91", city: "#3f475c", halo: "#eef0f4" },
  sky: { sky: "#a9cbef", horizon: "#e6edf6", fog: "#e3e6ec" },
  light: { color: "#ffffff", intensity: 0.4 },
};

/** One layer stack, two low-contrast palettes: safety colours carry the meaning, and switching theme is a paint-only style diff (no tile reload). */
function basemap(p: Palette, name: string): StyleSpecification {
  return {
    version: 8,
    name,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
    transition: { duration: 900, delay: 0 },
    sky: {
      "sky-color": p.sky.sky,
      "horizon-color": p.sky.horizon,
      "fog-color": p.sky.fog,
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 0.4],
    },
    light: { anchor: "viewport", color: p.light.color, intensity: p.light.intensity, position: [1.4, 205, 38] },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      {
        id: "landcover",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland", "scrub"]]],
        paint: { "fill-color": p.landcover, "fill-opacity": 0.55 },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": p.park, "fill-opacity": 0.7 },
      },
      {
        id: "landuse",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["in", ["get", "class"], ["literal", ["residential", "commercial", "industrial", "retail"]]],
        paint: { "fill-color": p.landuse, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": p.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: { "line-color": p.waterway, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 3] },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track"]]],
        minzoom: 12,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roads[0], "line-width": roadWidth(0.8) },
      },
      {
        id: "roads-mid",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["tertiary", "secondary"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roads[1], "line-width": roadWidth(1.2) },
      },
      {
        id: "roads-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["primary", "trunk", "motorway"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roads[2], "line-width": roadWidth(1.8) },
      },
      {
        id: "rail",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "rail"],
        paint: { "line-color": p.rail, "line-width": 1, "line-dasharray": [2, 2] },
      },
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "render_height"], 6],
            0,
            p.buildings[0],
            20,
            p.buildings[1],
            60,
            p.buildings[2],
            150,
            p.buildings[3],
          ],
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["coalesce", ["get", "render_height"], 6]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.88,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": NAME as unknown as string,
          "text-font": FONT_REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 13],
          "text-letter-spacing": 0.04,
        },
        paint: { "text-color": p.labels.road, "text-halo-color": p.labels.halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-neighbourhood",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter"]]],
        minzoom: 11,
        layout: {
          "text-field": NAME as unknown as string,
          "text-font": FONT_REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.18,
        },
        paint: { "text-color": p.labels.neighbourhood, "text-halo-color": p.labels.halo, "text-halo-width": 1.6 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": NAME as unknown as string,
          "text-font": FONT_BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 13, 18],
          "text-letter-spacing": 0.3,
          "text-transform": "uppercase",
        },
        paint: { "text-color": p.labels.city, "text-halo-color": p.labels.halo, "text-halo-width": 2 },
      },
    ],
  };
}

export const BASEMAPS: Record<MapTheme, StyleSpecification> = {
  night: basemap(NIGHT, "Musafira Midnight"),
  day: basemap(DAY, "Musafira Daylight"),
};
