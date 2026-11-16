/**
 * Reads TXT records, asking the zone's own nameservers first.
 *
 * Shared resolvers cache "no such record" answers for minutes, so a record the owner adds
 * right after a failed check can stay invisible. The zone's nameservers (GoDaddy's, for a
 * GoDaddy domain) answer from source. If they can't be reached (port 53 blocked, a name
 * below a delegated zone), the system resolver answers instead. The zone is the name minus
 * its first label: `_musafira.sharmachai.in` → `sharmachai.in`.
 */
import { Resolver } from "node:dns/promises";
import { UpstreamError } from "#src/lib/http.js";

const NO_RECORDS = new Set(["ENOTFOUND", "ENODATA"]);
const MAX_NAMESERVERS = 2;

const errorCode = (error: unknown) => (error as { code?: string }).code ?? "";

async function lookup(resolver: Resolver, name: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch (error) {
    if (NO_RECORDS.has(errorCode(error))) return [];
    throw error;
  }
}

async function nameserverResolver(zone: string): Promise<Resolver> {
  const system = new Resolver({ timeout: 3000, tries: 1 });
  const hosts = (await system.resolveNs(zone)).slice(0, MAX_NAMESERVERS);
  const addresses = (await Promise.all(hosts.map((host) => system.resolve4(host).catch(() => [])))).flat();
  if (addresses.length === 0) throw new Error("No nameserver addresses");
  const resolver = new Resolver({ timeout: 2500, tries: 1 });
  resolver.setServers(addresses);
  return resolver;
}

export async function txtRecords(name: string): Promise<string[]> {
  const authoritative = await nameserverResolver(name.slice(name.indexOf(".") + 1)).catch(() => undefined);
  const fromSource = authoritative ? await lookup(authoritative, name).catch(() => undefined) : undefined;
  if (fromSource) return fromSource;
  return lookup(new Resolver({ timeout: 4000, tries: 2 }), name).catch(() => {
    throw new UpstreamError("DNS");
  });
}
