import type { LngLat } from "../api/types";

export function locateRider(onPoint: (point: LngLat) => void, onError: (message: string) => void) {
  if (!navigator.geolocation) return onError("Location isn't available in this browser. Tap the map instead.");
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => onPoint([coords.longitude, coords.latitude]),
    () => onError("Couldn't get your location. Tap the map instead."),
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}
