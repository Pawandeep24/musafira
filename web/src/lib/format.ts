const MINUTE = 60_000;

/** City wall-clock fields read via getUTC*; keeps display correct whatever the browser's zone. */
export const cityTime = (instant: Date | string, utcOffsetMinutes: number) =>
  new Date(new Date(instant).getTime() + utcOffsetMinutes * MINUTE);

export function formatClock(instant: Date | string, utcOffsetMinutes: number): string {
  const local = cityTime(instant, utcOffsetMinutes);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

export function cityHour(instant: Date | string, utcOffsetMinutes: number): number {
  const local = cityTime(instant, utcOffsetMinutes);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

export function nextCityHour(hour: number, now: Date, utcOffsetMinutes: number): Date {
  const local = cityTime(now, utcOffsetMinutes);
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - utcOffsetMinutes * MINUTE;
  return new Date(target > now.getTime() ? target : target + 24 * 60 * MINUTE);
}

export function dayLabel(instant: Date, now: Date, utcOffsetMinutes: number): string {
  const day = (d: Date) => Math.floor(cityTime(d, utcOffsetMinutes).getTime() / (24 * 60 * MINUTE));
  const diff = day(instant) - day(now);
  const hour = cityHour(instant, utcOffsetMinutes);
  if (diff === 0) return hour >= 19 || hour < 4 ? "Tonight" : "Today";
  if (diff === 1) return hour < 4 ? "Tonight" : "Tomorrow";
  return cityTime(instant, utcOffsetMinutes).toUTCString().slice(0, 11);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function isNightHour(hour: number): boolean {
  return hour >= 18.5 || hour < 6;
}
