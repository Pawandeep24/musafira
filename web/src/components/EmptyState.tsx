import type { Place } from "../api/types";
import { Icon } from "./Icon";
import { Eyebrow } from "./ui/Eyebrow";

export interface DemoTrip {
  readonly title: string;
  readonly from: Place;
  readonly to: Place;
}

const place = (id: string, name: string, label: string, point: [number, number]): Place => ({ id, name, label, point });

export const DEMO_TRIPS: Record<string, readonly DemoTrip[]> = {
  pune: [
    {
      title: "Late shift home",
      from: place("demo:hinjewadi", "Hinjewadi Phase 1", "Hinjewadi, Pune", [73.738, 18.5913]),
      to: place("demo:shivajinagar", "Shivajinagar", "Shivajinagar, Pune", [73.8475, 18.5308]),
    },
    {
      title: "Edge of the city",
      from: place("demo:viman-nagar", "Viman Nagar", "Viman Nagar, Pune", [73.9143, 18.5679]),
      to: place("demo:kesnand", "Kesnand", "Kesnand, Pune", [73.9906, 18.6266]),
    },
  ],
  bengaluru: [
    {
      title: "Office to home",
      from: place("demo:whitefield", "Whitefield", "Whitefield, Bengaluru", [77.75, 12.9698]),
      to: place("demo:koramangala", "Koramangala", "Koramangala, Bengaluru", [77.6271, 12.9352]),
    },
    {
      title: "Airport road at night",
      from: place("demo:hebbal", "Hebbal", "Hebbal, Bengaluru", [77.5970, 13.0358]),
      to: place("demo:yelahanka", "Yelahanka", "Yelahanka, Bengaluru", [77.5963, 13.1007]),
    },
  ],
};

export function EmptyState({ cityId, onDemo }: { cityId: string; onDemo(trip: DemoTrip): void }) {
  const trips = DEMO_TRIPS[cityId] ?? [];
  return (
    <div className="empty">
      <h1>
        The fastest way home <em>isn't always the safest.</em>
      </h1>
      <p>
        Musafira rides every route ahead of you, minute by minute, and checks streetlights, open shops, police and help points, crowds and mobile
        signal for the hour you'll actually pass.
      </p>
      {trips.length > 0 && (
        <div className="empty__demos">
          <Eyebrow icon="sparkle">Try a ride at 11 pm tonight</Eyebrow>
          {trips.map((trip) => (
            <button key={trip.title} className="demo" onClick={() => onDemo(trip)}>
              <Icon name="moon" size={16} />
              <span>
                <strong>{trip.title}</strong>
                <small>
                  {trip.from.name} → {trip.to.name}
                </small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        <Icon name="pin" size={13} /> Tip: right-click the map to drop a start, then a destination.
      </p>
    </div>
  );
}
