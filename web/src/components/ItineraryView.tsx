import type { Itinerary, ItineraryLeg, ItineraryStop, SightKind, TripSlot } from "../api/types";
import { cityTime, formatClock, formatDistance, formatDuration } from "../lib/format";
import { Icon, type IconName } from "./Icon";

const FREE_TIME_MINUTES = 30;
const SLOT_LABEL: Record<TripSlot, string> = {
  breakfast: "Breakfast",
  morning: "Morning",
  lunch: "Lunch",
  afternoon: "Afternoon",
  snack: "Evening tea",
  dinner: "Dinner",
};
const KIND_LABEL: Record<SightKind, string> = {
  heritage: "Heritage",
  museum: "Museum",
  worship: "Place of worship",
  nature: "Nature",
  market: "Market",
  attraction: "Sight",
};
const SLOT_ICON: Record<TripSlot, IconName> = {
  breakfast: "coffee",
  morning: "landmark",
  lunch: "utensils",
  afternoon: "landmark",
  snack: "coffee",
  dinner: "utensils",
};
const FALLBACK_NOTICE: Partial<Record<NonNullable<Itinerary["fallback"]>, string>> = {
  unavailable: "The AI planner couldn't be reached, so this is our basic plan from the same places.",
  daily_limit: "Today's AI plans are used up, so this is our basic plan from the same places.",
};

const minutesBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
const sightKind = (stop: ItineraryStop): SightKind | undefined => (stop.kind in KIND_LABEL ? (stop.kind as SightKind) : undefined);

interface Props {
  itinerary: Itinerary;
  dayIndex: number;
  onDay(index: number): void;
  onEdit(): void;
  onCheckRoute(leg: ItineraryLeg, fromName: string, toName: string): void;
}

export function ItineraryView({ itinerary, dayIndex, onDay, onEdit, onCheckRoute }: Props) {
  const offset = itinerary.city.utcOffsetMinutes;
  const day = itinerary.days[dayIndex] ?? itinerary.days[0];
  if (!day) return null;
  const baseName = itinerary.base.name.split(",")[0]!;
  const notice = itinerary.fallback ? FALLBACK_NOTICE[itinerary.fallback] : undefined;
  const date = cityTime(day.startAt, offset).toUTCString().slice(0, 11);
  const home = day.legs.at(-1);
  const lastStop = day.stops.at(-1);

  const legRow = (key: string, leg: ItineraryLeg, freeSince: string, fromName: string, toName: string) => {
    const free = minutesBetween(freeSince, leg.departAt);
    return (
      <li key={key} className={`itinerary__leg ${leg.dark ? "is-dark" : ""}`}>
        <span className="itinerary__time">{formatClock(leg.departAt, offset)}</span>
        <span className="itinerary__ride">
          {free >= FREE_TIME_MINUTES && <small className="itinerary__free">Free time · {formatDuration(free * 60)}</small>}
          <span>
            <Icon name={leg.dark ? "moon" : "route"} size={13} /> {formatDistance(leg.distanceMeters)} · about {minutesBetween(leg.departAt, leg.arriveAt)} min
            {leg.dark && <strong> · after dark</strong>}
          </span>
        </span>
        <button className="link-button itinerary__check" onClick={() => onCheckRoute(leg, fromName, toName)}>
          Check route
        </button>
      </li>
    );
  };

  const baseRow = (key: string, at: string, label: string, detail?: string) => (
    <li key={key} className="itinerary__stop is-base">
      <span className="itinerary__time">{formatClock(at, offset)}</span>
      <span className="itinerary__dot">
        <Icon name="home" size={12} />
      </span>
      <div className="itinerary__body">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </li>
  );

  return (
    <div className="itinerary">
      <header className="itinerary__head">
        <span className={`itinerary__source is-${itinerary.source}`}>
          <Icon name="sparkle" size={12} /> {itinerary.source === "ai" ? "AI pick from real places" : "Basic plan"}
        </span>
        <h1>{itinerary.title}</h1>
        <p>
          {date} · from {baseName} ·{" "}
          <button className="link-button" onClick={onEdit}>
            Change answers
          </button>
        </p>
      </header>

      {notice && (
        <div className="notice notice--info">
          <Icon name="alert" size={15} /> {notice}
        </div>
      )}

      {itinerary.days.length > 1 && (
        <div className="segmented segmented--small itinerary__days" role="tablist">
          {itinerary.days.map((d) => (
            <button
              key={d.index}
              role="tab"
              aria-selected={d.index === day.index}
              className={d.index === day.index ? "is-on" : ""}
              onClick={() => onDay(d.index)}
            >
              Day {d.index + 1}
            </button>
          ))}
        </div>
      )}

      {!home || !lastStop ? (
        <p className="hint">Nothing fits this day before you need to be back. Try a later "back by" time.</p>
      ) : (
        <ol className="itinerary__timeline">
          {baseRow("start", day.legs[0]!.departAt, `Leave ${baseName}`)}
          {day.stops.flatMap((stop, i) => {
            const leg = day.legs[i]!;
            const previous = day.stops[i - 1];
            const kind = sightKind(stop);
            return [
              legRow(`leg-${stop.id}`, leg, previous?.leaveAt ?? leg.departAt, previous?.name ?? baseName, stop.name),
              <li key={stop.id} className={`itinerary__stop ${kind ? "is-see" : "is-eat"}`}>
                <span className="itinerary__time">{formatClock(stop.arriveAt, offset)}</span>
                <span className="itinerary__dot">{i + 1}</span>
                <div className="itinerary__body">
                  <span className="itinerary__slot">
                    <Icon name={SLOT_ICON[stop.slot]} size={12} /> {SLOT_LABEL[stop.slot]}
                    {kind && ` · ${KIND_LABEL[kind]}`}
                    {stop.famous && <em>Landmark</em>}
                  </span>
                  <strong>{stop.name}</strong>
                  <small>
                    {[stop.area, `${formatDuration(minutesBetween(stop.arriveAt, stop.leaveAt) * 60)} here`, stop.closesAt && `closes ${formatClock(stop.closesAt, offset)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {stop.note && (
                    <p className="itinerary__note" title="Written by AI">
                      <Icon name="sparkle" size={11} /> {stop.note}
                    </p>
                  )}
                </div>
              </li>,
            ];
          })}
          {legRow("leg-home", home, lastStop.leaveAt, lastStop.name, baseName)}
          {baseRow("end", home.arriveAt, `Back at ${baseName}`, `Dark from ${formatClock(day.dusk, offset)}`)}
        </ol>
      )}

      <p className="hint">
        <Icon name="clock" size={13} /> Ride times are estimates. Check route scores the real roads for that hour.
      </p>
    </div>
  );
}
