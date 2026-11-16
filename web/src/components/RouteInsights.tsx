import { useState } from "react";
import type { City, ParameterInfo, Route, Weights } from "@/api/types";
import { CATEGORY_LABEL, safetyCss } from "@/lib/colors";
import { formatClock, formatDistance } from "@/lib/format";
import { REPORT_META, reportAge, reportSummary } from "@/lib/reports";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/ui/Segmented";

interface Props {
  route: Route;
  parameters: readonly ParameterInfo[];
  weights: Weights;
  city: City;
}

type Tab = "why" | "along";

const TABS: readonly (readonly [Tab, string])[] = [
  ["why", "Why this score"],
  ["along", "Along the way"],
];

const emptyReason = (id: ParameterInfo["id"]) => (id === "lighting" ? "Daylight" : "No data");

export function RouteInsights({ route, parameters, weights, city }: Props) {
  const [tab, setTab] = useState<Tab>("why");
  const offset = city.utcOffsetMinutes;
  const ordered = [...parameters].sort((a, b) => weights[b.id] - weights[a.id]);
  const stops = route.stops.filter((s) => s.kinds.includes("safety") && s.open);
  const penalties = route.penalties.darkStretches + route.penalties.deadZones + route.penalties.stopGap + route.penalties.reported;

  return (
    <section className="insights">
      <Segmented small options={TABS} value={tab} onChange={setTab} />

      {tab === "why" && (
        <>
          <ul className="breakdown">
            {ordered.map((p) => {
              const value = route.breakdown[p.id];
              const muted = weights[p.id] === 0;
              return (
                <li key={p.id} className={muted ? "is-muted" : undefined} title={p.description}>
                  <Icon name={p.id} size={15} />
                  <span className="breakdown__label">{p.label}</span>
                  <span className="breakdown__bar">
                    {value !== null && (
                      <span style={{ width: `${value}%`, background: safetyCss(value / 100), boxShadow: `0 0 10px ${safetyCss(value / 100, 0.5)}` }} />
                    )}
                  </span>
                  <span className="breakdown__value">{value === null ? emptyReason(p.id) : value}</span>
                </li>
              );
            })}
          </ul>
          <div className="insights__footer">
            <span>
              Confidence <strong>{Math.round(route.confidence * 100)}%</strong>
            </span>
            {penalties > 0 && (
              <span>
                Penalties <strong className="is-risk">−{penalties.toFixed(1)}%</strong>
              </span>
            )}
            {route.liveTraffic && <span className="live-dot">Live traffic</span>}
          </div>
        </>
      )}

      {tab === "along" && (
        <ol className="timeline">
          {route.roadClosed && (
            <li className="timeline__item is-risk">
              <Icon name="alert" size={15} /> Road closure reported on this route right now
            </li>
          )}
          {route.darkStretches.map((s) => (
            <li key={`d${s.startMeters}`} className="timeline__item is-risk">
              <Icon name="lighting" size={15} />
              <span>
                <strong>{formatDistance(s.endMeters - s.startMeters)} poorly lit</strong> from km {(s.startMeters / 1000).toFixed(1)}
              </span>
            </li>
          ))}
          {route.deadZones.map((s) => (
            <li key={`z${s.startMeters}`} className="timeline__item is-warn">
              <Icon name="wifiOff" size={15} />
              <span>
                <strong>Weak signal</strong> for {formatDistance(s.endMeters - s.startMeters)} from km {(s.startMeters / 1000).toFixed(1)}
              </span>
            </li>
          ))}
          {route.reports.map((r) => (
            <li key={`r${r.category}${r.alongMeters}`} className={`timeline__item is-${REPORT_META[r.category].tone}`}>
              <Icon name={REPORT_META[r.category].icon} size={15} />
              <span>
                <strong>{reportSummary(r.count, r.category)}</strong>
                <small>
                  km {(r.alongMeters / 1000).toFixed(1)} · last reported {reportAge(r.lastObservedAt, new Date(), offset)}
                </small>
              </span>
            </li>
          ))}
          {stops.slice(0, 40).map((s) => (
            <li key={s.id} className="timeline__item">
              <span className="timeline__km">{(s.alongMeters / 1000).toFixed(1)}</span>
              <span>
                <strong>{s.name ?? CATEGORY_LABEL[s.category]}</strong>
                <small>
                  {CATEGORY_LABEL[s.category]} · {formatClock(s.arrival, offset)} ·{" "}
                  {s.closesAt ? `till ${formatClock(s.closesAt, offset)}` : "24h"}
                  {s.estimated ? " (typical)" : ""}
                </small>
              </span>
            </li>
          ))}
          {stops.length === 0 && <li className="timeline__item is-warn">No safety stop is open along this route at that hour.</li>}
        </ol>
      )}
    </section>
  );
}
