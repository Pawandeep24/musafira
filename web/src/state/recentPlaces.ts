import type { Place } from "@/api/types";

const MAX_RECENT = 5;
const storageKey = (cityId: string) => `musafira.recentPlaces.${cityId}`;

const isPlace = (value: unknown): value is Place => {
  const place = value as Partial<Place> | null;
  return (
    typeof place?.id === "string" &&
    typeof place.name === "string" &&
    typeof place.label === "string" &&
    Array.isArray(place.point) &&
    place.point.length === 2 &&
    place.point.every((n) => typeof n === "number")
  );
};

export function recentPlaces(cityId: string): Place[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(cityId)) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isPlace).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberPlace(cityId: string, place: Place): void {
  const recent = [place, ...recentPlaces(cityId).filter((p) => p.id !== place.id)].slice(0, MAX_RECENT);
  localStorage.setItem(storageKey(cityId), JSON.stringify(recent));
}
