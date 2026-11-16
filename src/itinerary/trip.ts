import type { LngLat } from "../geo/geometry.js";

export const TRIP_DAYS = [0.5, 1, 2, 3] as const;
export const INTERESTS = ["food", "heritage", "temples", "nature", "markets", "cafes"] as const;
export const DIETS = ["veg", "egg", "any"] as const;
export const BACK_BY = ["sunset", "20:00", "22:00"] as const;

export type TripDays = (typeof TRIP_DAYS)[number];
export type Interest = (typeof INTERESTS)[number];
export type Diet = (typeof DIETS)[number];
export type BackBy = (typeof BACK_BY)[number];

export interface TripRequest {
  readonly base: { readonly name: string; readonly point: LngLat };
  readonly days: TripDays;
  readonly interests: readonly Interest[];
  readonly diet: Diet;
  readonly backBy: BackBy;
}

export const SLOTS = ["breakfast", "morning", "lunch", "afternoon", "snack", "dinner"] as const;
export type Slot = (typeof SLOTS)[number];

const MEALS: ReadonlySet<Slot> = new Set(["breakfast", "lunch", "snack", "dinner"]);
export const isMeal = (slot: Slot) => MEALS.has(slot);

export const dayCount = (days: TripDays) => Math.ceil(days);

/** Dinner only fits when the rider is out late; a half day ends with lunch. */
export function slotsFor(trip: Pick<TripRequest, "days" | "backBy">): readonly Slot[] {
  if (trip.days === 0.5) return ["breakfast", "morning", "lunch"];
  return trip.backBy === "22:00" ? SLOTS : SLOTS.filter((slot) => slot !== "dinner");
}
