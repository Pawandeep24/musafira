import type { ParameterInfo, Route } from "@/api/types";
import { formatDistance } from "@/lib/format";

const RISKY_SCORE = 30;

const darkMeters = (route: Route) => route.darkStretches.reduce((sum, s) => sum + s.endMeters - s.startMeters, 0);
const openSafetyStops = (route: Route) => route.stops.filter((s) => s.open && s.kinds.includes("safety")).length;

/** One sentence comparing the safest route with the fastest, using the differences a rider would feel. */
export function routeVerdict(routes: readonly Route[], parameters: readonly ParameterInfo[]): string | null {
  const safest = routes.find((r) => r.labels.includes("safest"));
  const fastest = routes.find((r) => r.labels.includes("fastest"));
  if (!safest || !fastest) return null;
  if (safest.score < RISKY_SCORE) {
    return "Every route is risky at this hour. Try leaving earlier, or share your live location before you set off.";
  }
  if (safest === fastest) {
    return routes.length > 1 ? "The fastest route is also the safest at this hour." : "This is the only route we found for this trip.";
  }

  const reasons: string[] = [];
  const darkSaved = darkMeters(fastest) - darkMeters(safest);
  if (darkSaved >= 200) reasons.push(`${formatDistance(darkSaved)} less unlit road`);
  const extraStops = openSafetyStops(safest) - openSafetyStops(fastest);
  if (extraStops >= 2) reasons.push(`${extraStops} more open safety stops`);
  const deadZonesAvoided = fastest.deadZones.length - safest.deadZones.length;
  if (deadZonesAvoided > 0) reasons.push(`${deadZonesAvoided} fewer signal dead zones`);
  const gapSaved = fastest.longestStopGapMeters - safest.longestStopGapMeters;
  if (gapSaved >= 500) reasons.push(`help never more than ${formatDistance(safest.longestStopGapMeters)} away`);

  if (reasons.length === 0) {
    const best = parameters
      .map((p) => ({ label: p.label.toLowerCase(), gain: (safest.breakdown[p.id] ?? 0) - (fastest.breakdown[p.id] ?? 0) }))
      .sort((a, b) => b.gain - a.gain)[0];
    if (best && best.gain > 0) reasons.push(`better ${best.label}`);
  }

  const extraMinutes = Math.max(0, Math.round((safest.durationSeconds - fastest.durationSeconds) / 60));
  const cost = extraMinutes > 0 ? `${extraMinutes} min longer` : "just as quick";
  return reasons.length ? `Safest route is ${cost}, with ${reasons.slice(0, 2).join(" and ")}.` : `Safest route is ${cost} and scores higher overall.`;
}
