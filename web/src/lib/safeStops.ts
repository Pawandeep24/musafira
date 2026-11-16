import type { Language, SafeStopFeature, SafeStopHours, SafeStopKind, SafeStopProfile, Washroom, WashroomFacts } from "../api/types";

export const KIND_LABEL: Record<SafeStopKind, string> = {
  cafe: "Café or tea stall",
  restaurant: "Restaurant",
  shop: "Shop",
  pharmacy: "Pharmacy",
  fuel: "Fuel station",
  hotel: "Hotel",
  clinic: "Clinic",
  other: "Something else",
};

export const LANGUAGE_LABEL: Record<Language, string> = {
  kn: "ಕನ್ನಡ",
  mr: "मराठी",
  hi: "हिन्दी",
  en: "English",
  ta: "தமிழ்",
  te: "తెలుగు",
  ur: "اردو",
};

export interface FeatureGroup {
  readonly title: string;
  readonly features: readonly (readonly [SafeStopFeature, string])[];
}

export const WASHROOM_FEATURES: FeatureGroup = {
  title: "Inside the washroom",
  features: [
    ["washroom_inside", "Inside the shop"],
    ["separate_entry", "Its own entrance"],
    ["lock_inside", "Lock on the inside"],
    ["lit_inside", "Well lit"],
    ["running_water", "Running water"],
    ["soap", "Soap"],
    ["helmet_hook", "Hook for a helmet or bag"],
    ["western_toilet", "Western toilet"],
    ["indian_toilet", "Indian toilet"],
  ],
};

export const CARE_FEATURES: readonly FeatureGroup[] = [
  {
    title: "Period care",
    features: [
      ["tampons", "Tampons"],
      ["menstrual_cups", "Menstrual cups"],
      ["disposal_bin", "Covered disposal bin"],
      ["pad_vending", "Pad vending machine"],
      ["painkillers", "Painkillers"],
    ],
  },
  {
    title: "Safety",
    features: [
      ["staff_always", "Staff here all opening hours"],
      ["woman_on_shift", "A woman on every shift"],
      ["cctv", "CCTV"],
      ["lit_entrance", "Lit entrance"],
      ["guard", "Security guard"],
      ["wait_inside", "Riders can wait inside"],
      ["seating", "Seating"],
      ["first_aid", "First aid kit"],
      ["drinking_water", "Drinking water"],
      ["charging", "Phone charging"],
    ],
  },
  {
    title: "For riders",
    features: [
      ["parking_watched", "Parking in view of staff"],
      ["covered_parking", "Covered parking"],
      ["tyre_help", "Air or puncture help"],
    ],
  },
  {
    title: "Everyone welcome",
    features: [
      ["all_genders", "All genders welcome"],
      ["step_free", "Step-free entry"],
      ["baby_changing", "Baby changing"],
      ["feeding_space", "Space to feed a baby"],
    ],
  },
];

export const hoursLabel = (hours: SafeStopHours) => ("allDay" in hours ? "Open 24 hours" : `${hours.opens} to ${hours.closes}`);

export function accessLabel({ access, feeRupees }: SafeStopProfile) {
  if (access === "paid") return `₹${feeRupees ?? ""} to use`;
  return access === "anyone" ? "Anyone can use it" : "For customers";
}

export const ATTENDANT_LABEL: Record<SafeStopProfile["attendant"], string> = {
  always: "Looked after all day",
  daytime: "Looked after by day",
  none: "No attendant",
};

export const CLEANED_LABEL: Record<SafeStopProfile["cleaned"], string> = {
  hourly: "Cleaned every hour",
  few_daily: "Cleaned a few times a day",
  daily: "Cleaned daily",
};

export const PADS_LABEL: Record<SafeStopProfile["pads"], string | undefined> = {
  free: "Free sanitary pads",
  sold: "Sanitary pads for sale",
  none: undefined,
};

export const SOURCE_LABEL: Record<Washroom["source"], string> = {
  safeStop: "Safe Stop",
  public: "Public toilet",
  fuel: "Fuel station",
};

export const SOURCE_RGB: Record<Washroom["source"], readonly [number, number, number]> = {
  safeStop: [214, 140, 255],
  public: [90, 169, 255],
  fuel: [255, 190, 80],
};

export const washroomName = (washroom: Washroom) => washroom.name ?? (washroom.source === "fuel" ? "Fuel station washroom" : "Public toilet");

export type WashroomFilter = keyof Pick<WashroomFacts, "women" | "free" | "pads" | "attendant" | "wheelchair">;

export const FACT_LABEL: readonly (readonly [keyof WashroomFacts, string])[] = [
  ["women", "Women's"],
  ["free", "Free"],
  ["pads", "Pads"],
  ["attendant", "Attendant"],
  ["lockInside", "Lock inside"],
  ["wheelchair", "Accessible"],
  ["babyChanging", "Baby changing"],
];

export const FILTERS: readonly (readonly [WashroomFilter, string])[] = [
  ["women", "Women's"],
  ["free", "Free"],
  ["pads", "Pads"],
  ["attendant", "Attendant"],
  ["wheelchair", "Accessible"],
];
