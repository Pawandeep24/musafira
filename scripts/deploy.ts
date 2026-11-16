/**
 * Deploys Musafira to GoDaddy Node.js Hosting with the `gddy` CLI.
 *
 *   npm run deploy                 build here, upload, wait for the private preview
 *   npm run deploy -- --publish    ...then publish the preview to the live site
 *   npm run deploy -- --secrets    copy the server settings in .env to preview and live, restart both
 *
 * The host only installs runtime dependencies, so everything is built here: the bundle's
 * package.json turns `build` into a no-op and `start` runs the compiled server, which also
 * serves `web/dist`. `.env` never goes into the zip; its server settings become GoDaddy's
 * encrypted secrets, and values are never printed. GoDaddy reserves `NODE_ENV` and `PORT`.
 * `gddy` prints `{ "data": ... }` JSON.
 *
 * The host installs from package-lock.json and fails with no detail ("installing") on any
 * download URL that isn't the public npm tarball, `https://registry.npmjs.org/<name>/-/<file>-<version>.tgz`.
 * A corporate npm mirror writes such URLs, so the deploy stops before uploading if it finds one.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUNDLED = ["dist", "web/dist", "data/cities", "package-lock.json"];
const POLL_MS = 5_000;
const TIMEOUT_MS = 15 * 60_000;
const VARIANTS = ["PREVIEW", "PUBLISH"] as const;
const SERVER_SETTINGS = [
  "LOG_LEVEL",
  "VALHALLA_URL",
  "ORS_API_KEY",
  "TOMTOM_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_DAILY_BUDGET_USD",
  "NAMMA_YATRI_API_URL",
  "NAMMA_YATRI_LIVE",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "GODADDY_ENV",
];

const importSchema = z.object({ importId: z.string(), status: z.string() });
const deploymentSchema = z.object({ deploymentId: z.string(), status: z.string() });
const appSchema = z.object({ urls: z.object({ preview: z.string().optional(), publish: z.string().optional() }).optional() });
const secretNames = z.array(z.object({ name: z.string() }));
const lockSchema = z.object({ packages: z.record(z.string(), z.object({ version: z.string().optional(), resolved: z.string().optional() })) });

const env = { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gddy<T>(args: string[], schema: z.ZodType<T>, { hideErrors = false } = {}): T {
  try {
    const out = execFileSync("gddy", [...args, "--json"], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return z.object({ data: schema }).parse(JSON.parse(out)).data;
  } catch (err) {
    const detail = hideErrors ? "" : `\n${(err as { stderr?: string }).stderr ?? (err as Error).message}`;
    throw new Error(`gddy ${args.slice(0, 3).join(" ")} failed${detail}`);
  }
}

async function waitFor(what: string, status: () => string): Promise<void> {
  const start = Date.now();
  for (;;) {
    const now = status();
    if (now === "COMPLETED") return;
    if (/FAIL|ERROR|CANCEL/.test(now)) throw new Error(`${what} ${now.toLowerCase()}. Logs: gddy hosting log list --app-id <id> --level ERROR`);
    if (Date.now() - start > TIMEOUT_MS) throw new Error(`${what} still ${now} after ${TIMEOUT_MS / 60_000} minutes`);
    process.stdout.write(`  ${what}: ${now.toLowerCase()}\n`);
    await sleep(POLL_MS);
  }
}

function nonPublicTarballs(): string[] {
  const { packages } = lockSchema.parse(JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")));
  return Object.entries(packages).flatMap(([path, { version, resolved }]) => {
    if (!resolved) return [];
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    return resolved === `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz` ? [] : [name];
  });
}

function bundle(): string {
  const badTarballs = nonPublicTarballs();
  if (badTarballs.length) {
    throw new Error(`package-lock.json has non-public download URLs for ${badTarballs.join(", ")}; the host's install would fail`);
  }
  rmSync(join(ROOT, "dist"), { recursive: true, force: true });
  const build = { cwd: ROOT, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } } as const;
  execFileSync("npm", ["run", "build"], build);
  execFileSync("npm", ["run", "web:build"], build);

  const stage = mkdtempSync(join(tmpdir(), "musafira-deploy-"));
  for (const path of BUNDLED) cpSync(join(ROOT, path), join(stage, path), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  const hosted = { ...pkg, main: "dist/server.js", scripts: { build: "echo build", start: "node dist/server.js" } };
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(hosted, null, 2)}\n`);
  // Without it the host's install inherits a private registry and fails.
  writeFileSync(join(stage, ".npmrc"), "registry=https://registry.npmjs.org/\n");

  const zip = `${stage}.zip`;
  execFileSync("zip", ["-qr", zip, "."], { cwd: stage });
  return zip;
}

function serverSettings(): { name: string; value: string }[] {
  const godaddyEnv = (process.env.GODADDY_ENV ?? "ote").toUpperCase();
  const names = [...SERVER_SETTINGS, `GODADDY_${godaddyEnv}_API_KEY`, `GODADDY_${godaddyEnv}_API_SECRET`];
  return names.flatMap((name) => (process.env[name]?.trim() ? [{ name, value: process.env[name]!.trim() }] : []));
}

function syncSecrets(appId: string): void {
  const settings = serverSettings();
  for (const variant of VARIANTS) {
    const existing = new Set(gddy(["hosting", "secret", "list", "--app-id", appId, "--variant", variant], secretNames).map((s) => s.name));
    const additions = settings.filter((s) => !existing.has(s.name));
    const updates = settings.filter((s) => existing.has(s.name));
    gddy(
      [
        "hosting",
        "secret",
        "sync",
        "--app-id",
        appId,
        "--variant",
        variant,
        ...(additions.length ? ["--additions", JSON.stringify(additions)] : []),
        ...(updates.length ? ["--updates", JSON.stringify(updates)] : []),
      ],
      z.unknown(),
      { hideErrors: true },
    );
    console.log(`${variant}: set ${settings.map((s) => s.name).join(", ")}`);
    try {
      gddy(["hosting", "app", "restart", "--app-id", appId, "--variant", variant], z.unknown());
      console.log(`${variant}: restarted`);
    } catch {
      console.log(`${variant}: not running yet; the next deploy picks the settings up`);
    }
  }
}

async function deploy(appId: string, publish: boolean): Promise<void> {
  const zip = bundle();
  console.log("Uploading…");
  const upload = gddy(["hosting", "source", "upload", "--app-id", appId, "--file", zip], importSchema);
  await waitFor("Preview build", () => gddy(["hosting", "source", "status", "--app-id", appId, "--import-id", upload.importId], importSchema).status);
  const { urls } = gddy(["hosting", "app", "get", "--app-id", appId], appSchema);
  console.log(`Preview (only you, signed in to GoDaddy): ${urls?.preview ?? "see gddy hosting app get"}`);
  if (!publish) return;

  const release = gddy(["hosting", "deployment", "publish", "--app-id", appId], deploymentSchema);
  await waitFor("Publish", () => gddy(["hosting", "deployment", "get", "--app-id", appId, "--deployment-id", release.deploymentId], deploymentSchema).status);
  console.log(`Live: ${urls?.publish ?? "see gddy hosting app get"}`);
}

const appId = process.env.GDDY_APP_ID?.trim();
if (!appId) {
  console.error("Set GDDY_APP_ID in .env. Create the app once with: gddy hosting app create --app-type NODEJS --name musafira");
  process.exit(1);
}
const flags = new Set(process.argv.slice(2));
try {
  if (flags.has("--secrets")) syncSecrets(appId);
  else await deploy(appId, flags.has("--publish"));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
