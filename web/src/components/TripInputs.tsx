import { useState } from "react";
import { api } from "../api/client";
import type { Place } from "../api/types";
import { Icon } from "./Icon";
import { PlaceInput } from "./PlaceInput";

interface Props {
  cityId: string;
  from?: Place;
  to?: Place;
  onFrom(place: Place | undefined): void;
  onTo(place: Place | undefined): void;
  onSwap(): void;
}

export function TripInputs({ cityId, from, to, onFrom, onTo, onSwap }: Props) {
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const point: [number, number] = [coords.longitude, coords.latitude];
        const place = await api.reverse(point).catch(() => null);
        onFrom({ id: `gps:${point.join(",")}`, name: place?.name ?? "My location", label: place?.label ?? "My location", point });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="trip-inputs">
      <div className="trip-inputs__rail" />
      <PlaceInput
        cityId={cityId}
        value={from}
        {...(to ? { near: to.point } : {})}
        placeholder="Starting point"
        dotClass="is-origin"
        onChange={onFrom}
        trailing={
          <button className={`icon-button ${locating ? "is-busy" : ""}`} onClick={locate} title="Use my location" aria-label="Use my location">
            <Icon name="locate" size={16} />
          </button>
        }
      />
      <PlaceInput
        cityId={cityId}
        value={to}
        {...(from ? { near: from.point } : {})}
        placeholder="Where to?"
        dotClass="is-destination"
        onChange={onTo}
      />
      <button className="trip-inputs__swap icon-button" onClick={onSwap} title="Swap" aria-label="Swap start and destination">
        <Icon name="swap" size={16} />
      </button>
    </div>
  );
}
