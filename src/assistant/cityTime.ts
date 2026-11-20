/**
 * City wall-clock times for the assistant, as "YYYY-MM-DDTHH:mm" in the city's fixed UTC offset.
 * Claude reads and writes only these strings, so it never has to do time-zone arithmetic.
 */
const MINUTE = 60_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const CITY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const wallClock = (at: Date, utcOffsetMinutes: number) => new Date(at.getTime() + utcOffsetMinutes * MINUTE);

export const toCityTime = (at: Date, utcOffsetMinutes: number) => wallClock(at, utcOffsetMinutes).toISOString().slice(0, 16);

export const weekdayIn = (at: Date, utcOffsetMinutes: number) => WEEKDAYS[wallClock(at, utcOffsetMinutes).getUTCDay()]!;

export function fromCityTime(text: string, utcOffsetMinutes: number): Date | undefined {
  if (!CITY_TIME.test(text)) return undefined;
  const utc = Date.parse(`${text}:00Z`);
  return Number.isNaN(utc) || new Date(utc).toISOString().slice(0, 16) !== text ? undefined : new Date(utc - utcOffsetMinutes * MINUTE);
}
