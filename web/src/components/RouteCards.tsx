import type { Route } from "../api/types";
import { formatClock, formatDistance, formatDuration } from "../lib/format";
import { REPORT_META } from "../lib/reports";
import { Icon } from "./Icon";
import { SafetyStrip } from "./SafetyStrip";
import { ScoreRing } from "./ScoreRing";

interface Props {
  routes: readonly Route[];
  selectedId?: string;
  utcOffsetMinutes: number;
  onSelect(id: string): void;
}

const LABEL_TEXT = { safest: "Safest", fastest: "Fastest" } as const;

export function RouteCards({ routes, selectedId, utcOffsetMinutes, onSelect }: Props) {
  const fastest = Math.min(...routes.map((r) => r.durationSeconds));
  return (
    <div className="route-cards">
      {routes.map((route) => {
        const extraMinutes = Math.round((route.durationSeconds - fastest) / 60);
        const darkMeters = route.darkStretches.reduce((sum, s) => sum + s.endMeters - s.startMeters, 0);
        const concerns = route.reports.filter((r) => REPORT_META[r.category].tone !== "ok").reduce((sum, r) => sum + r.count, 0);
        return (
          <button
            key={route.id}
            className={`route-card ${route.id === selectedId ? "is-selected" : ""}`}
            onClick={() => onSelect(route.id)}
          >
            <ScoreRing score={route.score} size={58} />
            <div className="route-card__body">
              <div className="route-card__top">
                <span className="route-card__eta">{formatDuration(route.durationSeconds)}</span>
                {route.labels.map((label) => (
                  <span key={label} className={`chip chip--${label}`}>
                    {LABEL_TEXT[label]}
                  </span>
                ))}
              </div>
              <div className="route-card__meta">
                {formatDistance(route.distanceMeters)} · arrive {formatClock(route.arriveAt, utcOffsetMinutes)}
                {extraMinutes > 0 && <span className="route-card__extra"> · +{extraMinutes} min</span>}
              </div>
              <SafetyStrip route={route} height={7} />
              <div className="route-card__flags">
                {darkMeters > 0 ? (
                  <span className="flag flag--risk">
                    <Icon name="lighting" size={13} /> {formatDistance(darkMeters)} unlit
                  </span>
                ) : (
                  <span className="flag flag--ok">
                    <Icon name="lighting" size={13} /> No dark stretch
                  </span>
                )}
                {route.deadZones.length > 0 && (
                  <span className="flag flag--warn">
                    <Icon name="wifiOff" size={13} /> {route.deadZones.length} dead zone{route.deadZones.length > 1 ? "s" : ""}
                  </span>
                )}
                <span className={`flag ${route.longestStopGapMeters > 2000 ? "flag--warn" : "flag--ok"}`}>
                  <Icon name="safetyStops" size={13} /> gap {formatDistance(route.longestStopGapMeters)}
                </span>
                {concerns > 0 && (
                  <span className="flag flag--warn">
                    <Icon name="flag" size={13} /> {concerns} rider report{concerns > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
