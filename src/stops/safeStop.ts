/**
 * A vendor's Safe Stop: the onboarding questionnaire and how a listing proves its domain.
 *
 * Proof of domain: the owner publishes a TXT record at `_musafira.<domain>` with the value
 * `musafira-verify=<code>`, and the domain's registrar (from RDAP) must be GoDaddy. Only
 * someone who controls the domain's DNS can publish the record; the registrar check makes
 * it a GoDaddy domain. The record has its own name so it never clashes with the domain's
 * existing TXT records (mail SPF, other site verifications).
 *
 * Answers mirror OSM toilet tags where one exists (women/unisex counts → female/unisex,
 * access → fee, pads → toilets:menstrual_products, accessible → wheelchair, baby_changing →
 * changing_table), so vendor and OSM washrooms rank on the same facts.
 */
import { z } from "zod";

export const SAFE_STOP_KINDS = ["cafe", "restaurant", "shop", "pharmacy", "fuel", "hotel", "clinic", "other"] as const;

export const LANGUAGES = ["kn", "mr", "hi", "en", "ta", "te", "ur"] as const;

export const SAFE_STOP_FEATURES = [
  "washroom_inside",
  "separate_entry",
  "lock_inside",
  "lit_inside",
  "running_water",
  "soap",
  "helmet_hook",
  "western_toilet",
  "indian_toilet",
  "tampons",
  "menstrual_cups",
  "disposal_bin",
  "pad_vending",
  "painkillers",
  "staff_always",
  "woman_on_shift",
  "cctv",
  "lit_entrance",
  "guard",
  "wait_inside",
  "seating",
  "first_aid",
  "drinking_water",
  "charging",
  "parking_watched",
  "covered_parking",
  "tyre_help",
  "all_genders",
  "step_free",
  "baby_changing",
  "feeding_space",
] as const;

export type SafeStopFeature = (typeof SAFE_STOP_FEATURES)[number];

const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? "";
  return host.replace(/^www\./, "").replace(/\.$/, "");
}

export const domainSchema = z
  .string()
  .max(300)
  .transform(normalizeDomain)
  .pipe(z.string().regex(DOMAIN, "Enter a domain like sharmachai.in"));

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, like 07:30");

const hoursSchema = z.union([
  z.object({ allDay: z.literal(true) }).strict(),
  z
    .object({ opens: clock, closes: clock })
    .strict()
    .refine((h) => h.opens !== h.closes, "Opening and closing times must differ"),
]);

export type SafeStopHours = z.infer<typeof hoursSchema>;

/** OSM `opening_hours` for the declared hours; a closing time before opening runs past midnight. */
export const osmHours = (hours: SafeStopHours) => ("allDay" in hours ? "24/7" : `Mo-Su ${hours.opens}-${hours.closes}`);

const count = z.number().int().min(0).max(50);

export const safeStopProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    kind: z.enum(SAFE_STOP_KINDS),
    point: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    hours: hoursSchema,
    languages: z.array(z.enum(LANGUAGES)).max(LANGUAGES.length),
    washrooms: z
      .object({ total: count, women: count, unisex: count, accessible: count })
      .strict()
      .refine((w) => w.women + w.unisex <= w.total && w.accessible <= w.total, "Washroom counts can't add up to more than the total"),
    access: z.enum(["anyone", "customers", "paid"]),
    feeRupees: z.number().int().min(1).max(100).optional(),
    attendant: z.enum(["always", "daytime", "none"]),
    pads: z.enum(["free", "sold", "none"]),
    cleaned: z.enum(["hourly", "few_daily", "daily"]),
    features: z
      .array(z.enum(SAFE_STOP_FEATURES))
      .max(SAFE_STOP_FEATURES.length)
      .transform((features) => [...new Set(features)]),
    offer: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((offer) => offer || undefined),
    promise: z.literal(true, { error: "Accept the Safe Stop Promise to list your shop" }),
    domain: domainSchema,
  })
  .strict()
  .refine((p) => (p.access === "paid") === (p.feeRupees !== undefined), { message: "Set a fee only for paid washrooms", path: ["feeRupees"] });

export type SafeStopProfile = z.infer<typeof safeStopProfileSchema>;

export type SafeStopStatus = "draft" | "listed";

export interface SafeStop {
  readonly id: string;
  readonly ownerUid: string;
  readonly cityId: string;
  readonly profile: SafeStopProfile;
  readonly verifyCode: string;
  readonly status: SafeStopStatus;
  readonly registrar?: string;
  readonly verifiedAt?: Date;
  readonly updatedAt: Date;
}

export const verifyRecord = (domain: string, code: string) => ({ name: `_musafira.${domain}`, value: `musafira-verify=${code}` });

export const isGoDaddyRegistrar = (registrar: string | undefined) => /godaddy/i.test(registrar ?? "");

export const goDaddySearchUrl = (domain: string) => `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`;

const slug = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Web address ideas from the shop and city names; none when the name has no Latin letters to build from. */
export function domainIdeas(shopName: string, cityName: string): string[] {
  const shop = slug(shopName).slice(0, 40);
  if (shop.length < 3) return [];
  const city = slug(cityName);
  return [...new Set([`${shop}.in`, `${shop}.com`, `${shop}${city}.in`, `${shop}${city}.com`, `${shop}.co.in`])];
}
