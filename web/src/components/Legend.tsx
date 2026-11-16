import { useState } from "react";
import type { City } from "@/api/types";

const MAP_CREDITS = [
  { name: "OpenFreeMap", url: "https://openfreemap.org" },
  { name: "Valhalla", url: "https://valhalla.github.io/valhalla/" },
  { name: "TomTom", url: "https://www.tomtom.com" },
  { name: "openrouteservice", url: "https://openrouteservice.org" },
];

export function Legend({ showRoute, showLights, showSignal }: { showRoute: boolean; showLights: boolean; showSignal: boolean }) {
  if (!showRoute && !showLights && !showSignal) return null;
  return (
    <div className="legend glass">
      {showRoute && (
        <>
          <span className="legend__ramp">
            <small>Risky</small>
            <i />
            <small>Safe</small>
          </span>
          <span className="legend__item">
            <i className="swatch swatch--dark" /> Dark stretch
          </span>
          <span className="legend__item">
            <i className="swatch swatch--dead" /> Weak signal
          </span>
          <span className="legend__item">
            <i className="swatch swatch--stop" /> Open help point
          </span>
        </>
      )}
      {showLights && (
        <span className="legend__item">
          <i className="swatch swatch--lights" /> Light at night
        </span>
      )}
      {showSignal && (
        <span className="legend__item">
          <i className="swatch swatch--signal" /> Tower density
        </span>
      )}
    </div>
  );
}

export function Attribution({ city, compact }: { city?: City; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const credits = [...(city?.sources ?? []).map((s) => ({ name: s.attribution, url: s.url })), ...MAP_CREDITS];
  const shown = compact && !expanded ? credits.slice(0, 1) : credits;
  return (
    <div className={`attribution ${compact && expanded ? "is-expanded" : ""}`}>
      {shown.map((c, i) => (
        <span key={c.name}>
          {i > 0 && " · "}
          <a href={c.url} target="_blank" rel="noreferrer">
            {c.name}
          </a>
        </span>
      ))}
      {compact && credits.length > 1 && (
        <button className="attribution__more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-label={expanded ? "Fewer credits" : "All credits"}>
          {expanded ? "×" : "i"}
        </button>
      )}
    </div>
  );
}
