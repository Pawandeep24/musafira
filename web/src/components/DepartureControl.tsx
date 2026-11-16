import { useMemo } from "react";
import { skyGradient } from "@/lib/colors";
import { cityHour, dayLabel, formatClock, isNightHour } from "@/lib/format";
import type { Departure } from "@/state/usePlanner";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/ui/Segmented";

const MODES: readonly (readonly [Departure["mode"], string])[] = [
  ["now", "Leave now"],
  ["at", "Plan a time"],
];
const STEP_MINUTES = 15;
const HORIZON_HOURS = 24;
const STEPS = (HORIZON_HOURS * 60) / STEP_MINUTES;

interface Props {
  departure: Departure;
  utcOffsetMinutes: number;
  onChange(departure: Departure): void;
}

/** Departure as a sky: the slider track is the colour of the sky over the next 24 hours. */
export function DepartureControl({ departure, utcOffsetMinutes, onChange }: Props) {
  const now = useMemo(() => new Date(), [departure.mode]);
  const base = useMemo(() => {
    const rounded = new Date(now);
    rounded.setMinutes(Math.ceil(rounded.getMinutes() / STEP_MINUTES) * STEP_MINUTES, 0, 0);
    return rounded;
  }, [now]);

  const at = departure.mode === "at" ? departure.at : now;
  const step = departure.mode === "at" ? Math.round((at.getTime() - base.getTime()) / (STEP_MINUTES * 60_000)) : 0;
  const hour = cityHour(at, utcOffsetMinutes);
  const night = isNightHour(hour);

  return (
    <div className="departure">
      <Segmented options={MODES} value={departure.mode} onChange={(mode) => onChange(mode === "now" ? { mode: "now" } : { mode: "at", at: base })} />

      <div className={`departure__readout ${night ? "is-night" : "is-day"}`}>
        <Icon name={night ? "moon" : "sun"} size={18} />
        <span className="departure__time">{formatClock(at, utcOffsetMinutes)}</span>
        <span className="departure__day">{departure.mode === "now" ? "Now · live traffic" : dayLabel(at, now, utcOffsetMinutes)}</span>
      </div>

      {departure.mode === "at" && (
        <input
          className="sky-slider"
          type="range"
          min={0}
          max={STEPS}
          value={step}
          style={{ backgroundImage: skyGradient(cityHour(base, utcOffsetMinutes), HORIZON_HOURS) }}
          onChange={(e) => onChange({ mode: "at", at: new Date(base.getTime() + Number(e.target.value) * STEP_MINUTES * 60_000) })}
          aria-label="Departure time"
        />
      )}
    </div>
  );
}
