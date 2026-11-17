/**
 * Read-only go-live check for a domain on GoDaddy Node.js Hosting:
 *
 *   npm run golive:check -- musafira.app
 *
 * Each line is one fact a launch needs, read from the `gddy` CLI (`{ "data": ... }` JSON on stdout,
 * or `{ "error": { "message" } }` on stderr with a non-zero exit) or from the live site: the CLI targets
 * production, the domain is active in the account, it is attached to GDDY_APP_ID with its
 * certificate issued, its A record is the attachment's anycast IP, https:// answers on the apex
 * and www while http:// redirects, a mailbox on the domain is ready, MX/SPF/DKIM/DMARC exist,
 * and the deployed app shows the contact address, which it only does once its SMTP settings
 * are in place. Nothing is changed and no mail is sent. Exits 1 when any check fails.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const TIMEOUT_MS = 15_000;

const cliEnvSchema = z.object({ env: z.string(), apiUrl: z.string() });
const domainSchema = z.object({ status: z.string() });
const attachedSchema = z.array(z.object({ hostname: z.string(), verificationStatus: z.string(), anycastIp: z.string().nullish() }));
const recordsSchema = z.array(z.object({ type: z.string(), name: z.string(), data: z.string() }));
const mailboxesSchema = z.array(z.object({ emailAddress: z.string(), status: z.string() }));
const errorSchema = z.object({ error: z.object({ message: z.string() }) });
const siteConfigSchema = z.object({ contactEmail: z.string().optional() });

const env = { ...process.env, PATH: `${join(homedir(), ".local", "bin")}:${process.env.PATH ?? ""}` };

function gddy<T>(args: string[], schema: z.ZodType<T>): T {
  let out: string;
  try {
    out = execFileSync("gddy", [...args, "--json"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    out = String((err as { stderr?: unknown }).stderr ?? "");
  }
  const reply: unknown = JSON.parse(out || "{}");
  const ok = z.object({ data: schema }).safeParse(reply);
  if (ok.success) return ok.data.data;
  const failed = errorSchema.safeParse(reply);
  // GoDaddy appends its raw JSON reply after ": {"; the readable part comes first.
  throw new Error(failed.success ? failed.data.error.message.split(": {")[0]! : `unexpected reply from gddy ${args.slice(0, 2).join(" ")}`);
}

async function get(url: string): Promise<Response> {
  try {
    return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    throw new Error(code ? `unreachable (${code})` : (err as Error).message);
  }
}

async function loads(url: string): Promise<string> {
  const res = await get(url);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return "200 OK";
}

function checks(domain: string, appId: string): [string, () => Promise<string> | string][] {
  const attachment = () => {
    const found = gddy(["hosting", "domain", "list", "--app-id", appId, "--fields", "all"], attachedSchema).find((d) => d.hostname === domain);
    if (!found) throw new Error(`not attached; run gddy hosting domain attach --app-id ${appId} --hostname ${domain}`);
    return found;
  };
  const records = () => gddy(["dns", "list", domain], recordsSchema);

  return [
    [
      "gddy CLI targets production",
      () => {
        const cli = gddy(["env", "get"], cliEnvSchema);
        if (cli.env !== "prod") throw new Error(`on ${cli.env}; run gddy env set prod`);
        return cli.apiUrl;
      },
    ],
    [
      "Domain active in your account",
      () => {
        const { status } = gddy(["domain", "get", domain], domainSchema);
        if (status !== "ACTIVE") throw new Error(status);
        return status;
      },
    ],
    [
      "Domain attached to the app",
      () => {
        const { verificationStatus } = attachment();
        if (verificationStatus !== "ACTIVE") throw new Error(`${verificationStatus}; the certificate is still being issued`);
        return `${appId}, certificate issued`;
      },
    ],
    [
      "DNS points at the app",
      () => {
        const { anycastIp } = attachment();
        const a = records().filter((r) => r.type === "A" && r.name === "@").map((r) => r.data);
        if (!anycastIp || !a.includes(anycastIp)) throw new Error(`A @ is ${a.join(", ") || "missing"}, expected ${anycastIp ?? "the app's IP"}`);
        return `A @ ${anycastIp}`;
      },
    ],
    [`https://${domain} loads`, () => loads(`https://${domain}/`)],
    [`https://www.${domain} loads`, () => loads(`https://www.${domain}/`)],
    [
      "http:// redirects to https://",
      async () => {
        const res = await get(`http://${domain}/`);
        const location = res.headers.get("location") ?? "";
        if (res.status < 300 || res.status >= 400 || !location.startsWith("https://")) throw new Error(`HTTP ${res.status} ${location}`.trim());
        return `${res.status} to ${location}`;
      },
    ],
    [
      "Mailbox on the domain ready",
      () => {
        const ready = gddy(["email", "list"], mailboxesSchema).filter((m) => m.emailAddress.endsWith(`@${domain}`) && m.status === "COMPLETED");
        if (!ready.length) throw new Error("none yet; create one on godaddy.com or with gddy email create");
        return ready.map((m) => m.emailAddress).join(", ");
      },
    ],
    [
      "Mail DNS: MX, SPF, DKIM, DMARC",
      () => {
        const all = records();
        const missing = [
          ["MX", all.some((r) => r.type === "MX")],
          ["SPF", all.some((r) => r.type === "TXT" && r.name === "@" && r.data.startsWith("v=spf1"))],
          ["DKIM", all.some((r) => r.name.includes("._domainkey"))],
          ["DMARC", all.some((r) => r.type === "TXT" && r.name === "_dmarc" && r.data.startsWith("v=DMARC1"))],
        ].flatMap(([name, present]) => (present ? [] : [name]));
        if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
        return "all present";
      },
    ],
    [
      "Contact form live",
      async () => {
        const res = await get(`https://${domain}/api/config`);
        if (res.status !== 200) throw new Error(`/api/config gave HTTP ${res.status}`);
        const { contactEmail } = siteConfigSchema.parse(await res.json());
        if (!contactEmail) throw new Error("hidden; set SMTP_PASSWORD in .env, then npm run deploy -- --secrets and -- --publish");
        return `sends to ${contactEmail}`;
      },
    ],
  ];
}

const domain = process.argv[2]?.trim().toLowerCase();
const appId = process.env.GDDY_APP_ID?.trim();
if (!domain || !appId) {
  console.error(appId ? "Usage: npm run golive:check -- <domain>" : "Set GDDY_APP_ID in .env");
  process.exit(1);
}

console.log(`Go-live check for ${domain}\n`);
let failures = 0;
for (const [name, run] of checks(domain, appId)) {
  try {
    console.log(`  ✓ ${name.padEnd(34)} ${await run()}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${name.padEnd(34)} ${(err as Error).message}`);
  }
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nReady to go live.");
process.exit(failures ? 1 : 0);
