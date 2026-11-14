import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RAW_DIR = join(import.meta.dirname, "../../data/raw");
export const USER_AGENT = "musafira-safe-routes-ingest/0.1 (hackathon project)";

/** Runs `produce` once and keeps the result in data/raw, so re-runs spend no API quota. */
export async function cachedJson<T>(name: string, produce: () => Promise<T>): Promise<T> {
  const path = join(RAW_DIR, name);
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    const value = await produce();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
    return value;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
