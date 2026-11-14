import type { Route } from "../api/types";
import { safetyCss } from "../lib/colors";

/** The whole ride as one bar: colour per 100 m, rose brackets for dark stretches, ticks for open safety stops. */
export function SafetyStrip({ route, height = 10, progressMeters }: { route: Route; height?: number; progressMeters?: number }) {
  const total = route.segments.at(-1)?.endMeters ?? 1;
  const x = (meters: number) => (meters / total) * 100;
  return (
    <svg className="safety-strip" viewBox={`0 0 100 ${height + 6}`} preserveAspectRatio="none" style={{ height: height + 6 }}>
      {route.segments.map((s) => (
        <rect key={s.startMeters} x={x(s.startMeters)} y={3} width={x(s.endMeters - s.startMeters) + 0.05} height={height} fill={safetyCss(s.score)} />
      ))}
      {route.darkStretches.map((s) => (
        <rect
          key={`d${s.startMeters}`}
          x={x(s.startMeters)}
          y={0.5}
          width={x(s.endMeters - s.startMeters)}
          height={height + 5}
          fill="none"
          stroke="#ff3d6e"
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
          rx={1}
        />
      ))}
      {route.stops
        .filter((s) => s.open && s.kinds.includes("safety"))
        .map((s) => (
          <rect key={s.id} x={x(s.alongMeters) - 0.15} y={height + 2} width={0.3} height={4} fill="rgba(255,255,255,0.85)" />
        ))}
      {progressMeters !== undefined && <rect x={x(progressMeters) - 0.4} y={0} width={0.8} height={height + 6} fill="#fff" />}
    </svg>
  );
}
