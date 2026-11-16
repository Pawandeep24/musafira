import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  GODADDY_ENV: z.enum(["ote", "production"]).default("ote"),
  GODADDY_OTE_API_KEY: z.string().min(1).optional(),
  GODADDY_OTE_API_SECRET: z.string().min(1).optional(),
  GODADDY_PRODUCTION_API_KEY: z.string().min(1).optional(),
  GODADDY_PRODUCTION_API_SECRET: z.string().min(1).optional(),

  VALHALLA_URL: z.string().url().default("https://valhalla1.openstreetmap.de"),
  ORS_API_KEY: z.string().min(1).optional(),
  TOMTOM_API_KEY: z.string().min(1).optional(),
  OPENCELLID_API_KEY: z.string().min(1).optional(),
  NASA_EARTHDATA_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_DAILY_BUDGET_USD: z.coerce.number().positive().default(1),
  NAMMA_YATRI_API_URL: z.string().url().default("https://api.moving.tech/pilot/app/v2"),
  NAMMA_YATRI_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_WEB_API_KEY: z.string().min(1).optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().min(1).optional(),
  FIRESTORE_EMULATOR_HOST: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

/** Parse + validate env once, failing fast with a readable message (never echoing values). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` in a .env file yields "" - treat blank values as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
