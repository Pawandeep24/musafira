import type { Place } from "../api/types";
import { cityHour, dayLabel, formatClock, isNightHour } from "../lib/format";
import type { Departure } from "../state/usePlanner";
import { Icon } from "./Icon";

interface Props {
  from: Place;
  to: Place;
  departure: Departure;
  utcOffsetMinutes: number;
  onEdit(): void;
}

export function TripSummary({ from, to, departure, utcOffsetMinutes, onEdit }: Props) {
  const now = new Date();
  const at = departure.mode === "at" ? departure.at : now;
  const when = departure.mode === "now" ? "Leaving now · live traffic" : `${formatClock(at, utcOffsetMinutes)} · ${dayLabel(at, now, utcOffsetMinutes)}`;
  return (
    <button className="trip-summary" onClick={onEdit} aria-label={`Edit trip: ${from.name} to ${to.name}, ${when}`}>
      <span className="trip-summary__route">
        <span className="trip-summary__place">
          <i className="place-input__dot is-origin" />
          <span>{from.name}</span>
        </span>
        <Icon name="chevron" size={13} />
        <span className="trip-summary__place">
          <i className="place-input__dot is-destination" />
          <span>{to.name}</span>
        </span>
      </span>
      <span className="trip-summary__when">
        <Icon name={isNightHour(cityHour(at, utcOffsetMinutes)) ? "moon" : "sun"} size={14} /> {when}
      </span>
      <span className="trip-summary__edit">Edit</span>
    </button>
  );
}
