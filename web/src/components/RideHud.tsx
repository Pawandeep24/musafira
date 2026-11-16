import { useEffect, useState } from "react";
import type { Route, Segment, Stretch } from "../api/types";
import { CATEGORY_LABEL, safetyCss } from "../lib/colors";
import { formatClock, formatDistance } from "../lib/format";
import { previewMetersAt, type PreviewCamera, type RidePreview } from "../state/ridePreview";
import { Icon, type IconName } from "./Icon";
import { SafetyStrip } from "./SafetyStrip";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Segmented } from "./ui/Segmented";

interface Props {
  route: Route;
  preview: RidePreview;
  utcOffsetMinutes: number;
  speed: number;
  camera: PreviewCamera;
  compact: boolean;
  onSpeed(multiplier: number): void;
  onCamera(camera: PreviewCamera): void;
  onTogglePause(): void;
  onExit(): void;
}

const LOOKAHEAD_METERS = 1500;

const SPEEDS: readonly (readonly [number, string])[] = [
  [1, "1×"],
  [2, "2×"],
  [4, "4×"],
];

const CAMERAS: readonly (readonly [PreviewCamera, string])[] = [
  ["close", "Close"],
  ["street", "Street"],
  ["wide", "Wide"],
];

function mood(score: number | null): string {
  if (score === null) return "No data here";
  if (score >= 0.7) return "Safe stretch";
  if (score >= 0.45) return "Stay alert";
  return "Risky stretch";
}

function segmentChips(segment: Segment): { icon: IconName; text: string }[] {
  const { lighting, crowd, signal, openShops } = segment.values;
  const chips: { icon: IconName; text: string }[] = [];
  if (segment.dark && lighting !== null) chips.push({ icon: "lighting", text: lighting > 0.6 ? "Well lit" : lighting > 0.35 ? "Dim" : "Dark" });
  if (crowd !== null) chips.push({ icon: "crowd", text: crowd > 0.5 ? "People around" : crowd > 0.2 ? "Few people" : "Deserted" });
  if (signal !== null) chips.push({ icon: "signal", text: signal > 0.5 ? "Strong signal" : signal > 0.25 ? "Patchy signal" : "No signal" });
  if (openShops !== null && openShops > 0.3) chips.push({ icon: "openShops", text: "Shops open" });
  return chips;
}

interface Alert {
  id: string;
  tone: "risk" | "warn" | "ok";
  icon: IconName;
  title: string;
  detail: string;
}

const containing = (stretches: readonly Stretch[], meters: number) => stretches.find((s) => s.startMeters <= meters && meters < s.endMeters);

function nextAlert(route: Route, meters: number, offset: number): Alert | null {
  const inDark = containing(route.darkStretches, meters);
  if (inDark) {
    return {
      id: `in-dark-${inDark.startMeters}`,
      tone: "risk",
      icon: "lighting",
      title: `Poorly lit for the next ${formatDistance(inDark.endMeters - meters)}`,
      detail: "Keep moving and stay on the main carriageway.",
    };
  }
  const inDead = containing(route.deadZones, meters);
  if (inDead) {
    return {
      id: `in-dead-${inDead.startMeters}`,
      tone: "warn",
      icon: "wifiOff",
      title: `No signal for the next ${formatDistance(inDead.endMeters - meters)}`,
      detail: "Your live location may pause until coverage returns.",
    };
  }
  const dark = route.darkStretches.find((s) => s.startMeters > meters && s.startMeters - meters < LOOKAHEAD_METERS);
  if (dark) {
    return {
      id: `dark-${dark.startMeters}`,
      tone: "risk",
      icon: "lighting",
      title: `Dark stretch in ${formatDistance(dark.startMeters - meters)}`,
      detail: `${formatDistance(dark.endMeters - dark.startMeters)} with poor lighting. Keep to the centre of the road.`,
    };
  }
  const dead = route.deadZones.find((s) => s.startMeters > meters && s.startMeters - meters < LOOKAHEAD_METERS);
  if (dead) {
    return {
      id: `dead-${dead.startMeters}`,
      tone: "warn",
      icon: "wifiOff",
      title: `Weak signal in ${formatDistance(dead.startMeters - meters)}`,
      detail: "Share your live location before you lose coverage.",
    };
  }
  const stop = route.stops.find((s) => s.open && s.kinds.includes("safety") && s.alongMeters > meters);
  if (stop) {
    return {
      id: `stop-${stop.id}`,
      tone: "ok",
      icon: "safetyStops",
      title: `${stop.name ?? CATEGORY_LABEL[stop.category]} in ${formatDistance(stop.alongMeters - meters)}`,
      detail: `${CATEGORY_LABEL[stop.category]} · ${stop.closesAt ? `open till ${formatClock(stop.closesAt, offset)}` : "open 24 hours"}`,
    };
  }
  return null;
}

export function RideHud({ route, preview, utcOffsetMinutes, speed, camera, compact, onSpeed, onCamera, onTogglePause, onExit }: Props) {
  const [meters, setMeters] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setMeters(previewMetersAt(preview, performance.now())), 100);
    return () => clearInterval(timer);
  }, [preview]);

  const total = route.segments.at(-1)?.endMeters ?? 0;
  const segment = route.segments.find((s) => s.endMeters >= meters) ?? route.segments.at(-1);
  if (!segment) return null;
  const alert = nextAlert(route, meters, utcOffsetMinutes);

  return (
    <div className="hud">
      <div className="hud__bar glass">
        <div className="hud__clock">
          <Icon name={segment.dark ? "moon" : "sun"} size={18} />
          <span>{formatClock(segment.arrival, utcOffsetMinutes)}</span>
        </div>
        <div className="hud__mood" style={{ color: safetyCss(segment.score), borderColor: safetyCss(segment.score, 0.5) }}>
          <span className="hud__score">{segment.score === null ? "–" : Math.round(segment.score * 100)}</span>
          {mood(segment.score)}
        </div>
        <div className="hud__chips">
          {segmentChips(segment).map((chip) => (
            <span key={chip.text} className="hud__chip">
              <Icon name={chip.icon} size={13} /> {chip.text}
            </span>
          ))}
        </div>
        {compact && <IconButton icon="close" label="Exit preview" className="hud__exit" onClick={onExit} />}
      </div>

      {alert && (
        <div className={`hud__alert glass tone-${alert.tone}`} key={alert.id}>
          <Icon name={alert.icon} size={22} />
          <div>
            <strong>{alert.title}</strong>
            <span>{alert.detail}</span>
          </div>
        </div>
      )}

      <div className="hud__footer glass">
        {preview.paused && <div className="hud__paused">Paused · move the map to look around</div>}
        <SafetyStrip route={route} height={8} progressMeters={meters} />
        <div className="hud__controls">
          <div className="hud__progress">
            <IconButton
              icon={preview.paused ? "play" : "pause"}
              label={preview.paused ? "Resume preview" : "Pause preview"}
              className={preview.paused ? "hud__pause is-paused" : "hud__pause"}
              onClick={onTogglePause}
            />
            <span>
              {formatDistance(meters)} of {formatDistance(total)}
            </span>
          </div>
          <Segmented kind="toggle" small label="Speed" options={SPEEDS} value={speed} onChange={onSpeed} />
          <Segmented kind="toggle" small label="Camera" options={CAMERAS} value={camera} onChange={onCamera} />
          {!compact && (
            <Button variant="ghost" onClick={onExit}>
              <Icon name="close" size={14} /> Exit preview
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
