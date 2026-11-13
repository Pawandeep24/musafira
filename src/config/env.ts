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
