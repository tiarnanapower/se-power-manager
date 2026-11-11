// Read-only access to the sample-data GitHub repo. The app never writes to it: samples change
// only when someone with access to the repo commits to it.
import "server-only";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { AppError } from "@/lib/errors/app-error";

const DEFAULT_REPO = "tiarnanapower/bc-sample-data";
const DEFAULT_REF = "main";
const TEXT_TTL_MS = 5 * 60_000;
const MAX_CACHED_BYTES = 40 * 1024 * 1024;

export interface SamplesRepoConfig {
  repo: string; // owner/name
  ref: string;
  token: string | undefined;
}

export function samplesConfig(): SamplesRepoConfig {
  return {
    repo: process.env.SAMPLES_REPO?.trim() || DEFAULT_REPO,
    ref: process.env.SAMPLES_REF?.trim() || DEFAULT_REF,
    token: process.env.SAMPLES_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined,
  };
}

interface CacheEntry {
  at: number;
  bytes: Buffer;
}

// Per server instance. Samples change rarely, and this keeps a browsing session from spending the GitHub rate limit.
const cache = new Map<string, CacheEntry>();
let cachedBytes = 0;

function remember(key: string, bytes: Buffer): void {
  if (bytes.length > MAX_CACHED_BYTES / 4) return;

  cache.set(key, { at: Date.now(), bytes });
  cachedBytes += bytes.length;

  for (const [oldKey, entry] of cache) {
    if (cachedBytes <= MAX_CACHED_BYTES) break;

    cache.delete(oldKey);
    cachedBytes -= entry.bytes.length;
  }
}

function headers(config: SamplesRepoConfig, accept: string): Record<string, string> {
  return { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "se-power-manager", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) };
}

// Paths come from our own format helpers, but the app also builds them from URL parts, so each segment is checked.
function safePath(path: string): string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "." || part === "")) throw new AppError("VALIDATION", "Invalid sample path.");

  return path.split("/").map(encodeURIComponent).join("/");
}

function explain(status: number, path: string): AppError {
  if (status === 404) return new AppError("NOT_FOUND", `${path} isn't in the samples repo.`, { status, detail: `${path} isn't in the samples repo. Check the sample exists and the repo name and branch are right.` });
  if (status === 401 || status === 403) return new AppError("AUTH", "GitHub refused access.", { status, detail: "GitHub refused access to the samples repo. Check SAMPLES_GITHUB_TOKEN has read access to it, and that its rate limit isn't used up." });

  return new AppError("UPSTREAM_API", `GitHub answered ${status}.`, { status, detail: `GitHub answered ${status} when reading ${path}.` });
}

// SAMPLES_LOCAL_DIR points at a local clone of the samples repo, for developing and testing samples
// before they are pushed. It replaces GitHub entirely while set.
async function readLocal(dir: string, path: string): Promise<Buffer> {
  safePath(path);

  const root = resolve(dir);
  const file = resolve(join(root, path));

  if (file !== root && !file.startsWith(root + sep)) throw new AppError("VALIDATION", "Invalid sample path.");

  try {
    return await readFile(file);
  } catch {
    throw explain(404, path);
  }
}

export async function readBytes(path: string, options: { ttlMs?: number } = {}): Promise<Buffer> {
  const localDir = process.env.SAMPLES_LOCAL_DIR?.trim();

  if (localDir) return readLocal(localDir, path);

  const config = samplesConfig();
  const key = `${config.repo}@${config.ref}:${path}`;
  const hit = cache.get(key);

  if (hit && Date.now() - hit.at < (options.ttlMs ?? TEXT_TTL_MS)) return hit.bytes;

  let response: Response;

  try {
    response = await fetch(`https://api.github.com/repos/${config.repo}/contents/${safePath(path)}?ref=${encodeURIComponent(config.ref)}`, { headers: headers(config, "application/vnd.github.raw+json"), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError("UPSTREAM_API", "Could not reach GitHub.", { cause: error, detail: "Could not reach GitHub to read the samples." });
  }

  if (!response.ok) throw explain(response.status, path);

  const bytes = Buffer.from(await response.arrayBuffer());

  remember(key, bytes);

  return bytes;
}

export async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse((await readBytes(path)).toString("utf8")) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError("VALIDATION", `${path} isn't valid JSON.`, { cause: error, detail: `${path} in the samples repo isn't valid JSON.` });
  }
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

// Commits that touched a path, newest first: the sample's change history.
export async function listCommits(path: string, limit = 30): Promise<CommitInfo[]> {
  // A local clone has no GitHub history to show.
  if (process.env.SAMPLES_LOCAL_DIR?.trim()) return [];

  const config = samplesConfig();
  const response = await fetch(`https://api.github.com/repos/${config.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(config.ref)}&per_page=${limit}`, { headers: headers(config, "application/vnd.github+json"), cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => undefined);

  if (!response) throw new AppError("UPSTREAM_API", "Could not reach GitHub.", { detail: "Could not reach GitHub to read the history." });
  if (!response.ok) throw explain(response.status, path);

  const rows = (await response.json()) as { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } } }[];

  return rows.map((row) => ({ sha: row.sha.slice(0, 7), message: row.commit.message.split("\n")[0], author: row.commit.author?.name ?? "Unknown", date: row.commit.author?.date ?? "", url: row.html_url }));
}

export const resetSamplesCache = () => {
  cache.clear();
  cachedBytes = 0;
};
