import { useState } from "react";
import { api } from "../api/client";
import type { Place } from "../api/types";
import { PlaceInput } from "./PlaceInput";
import { IconButton } from "./ui/IconButton";

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
        trailing={<IconButton icon="locate" label="Use my location" title="Use my location" className={locating ? "is-busy" : undefined} onClick={locate} />}
      />
      <PlaceInput
        cityId={cityId}
        value={to}
        {...(from ? { near: from.point } : {})}
        placeholder="Where to?"
        dotClass="is-destination"
        onChange={onTo}
      />
      <IconButton icon="swap" label="Swap start and destination" title="Swap" className="trip-inputs__swap" onClick={onSwap} />
    </div>
  );
}
