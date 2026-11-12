// Captures a BigCommerce store's catalog as a new version of a sample, written to a local clone of the
// samples repo. Nothing is pushed: review the files, then commit them yourself.
//
//   pnpm samples:capture --name "Outdoor Retailer" --out ../se-demo-catalogs \
//     [--slug outdoor-retailer] [--description "..."] [--tags uk,outdoor] [--notes "What changed"] \
//     [--sections shipping,tax]
//
// The store comes from STATIC_STORE_HASH and STATIC_STORE_TOKEN in .env.local (or --store-hash / --token).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ApiRequestOptions, ApiResponse, BcRestApiClient } from "../src/lib/bc-api-client/rest-client/types";
import { captureCatalogSample } from "../src/lib/samples/capture";
import type { SampleSectionId } from "../src/lib/samples/format";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);

  return at >= 0 ? args[at + 1] : undefined;
};

const name = flag("name");
const out = resolve(flag("out") ?? "../se-demo-catalogs");
const storeHash = flag("store-hash") ?? process.env.STATIC_STORE_HASH;
const token = flag("token") ?? process.env.STATIC_STORE_TOKEN;

if (!name || !storeHash || !token) {
  console.error('Usage: pnpm samples:capture --name "Sample name" [--out ../se-demo-catalogs]\nNeeds STATIC_STORE_HASH and STATIC_STORE_TOKEN in .env.local (or --store-hash and --token).');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A read-only client: capture only ever reads from the store. `base` is the API root, so the same
// client also reaches the B2B Edition API.
const readOnlyClient = (base: string): BcRestApiClient => ({
  async get<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    const url = new URL(`${base}${path}`);

    for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { headers: { "X-Auth-Token": token, Accept: "application/json", ...(base.includes("api-b2b") ? { "X-Store-Hash": storeHash } : {}) } });

      if (response.status === 429 && attempt < 6) {
        await sleep(Number(response.headers.get("X-Rate-Limit-Time-Reset-Ms") ?? 1000) + 200);
        continue;
      }
      if (!response.ok) throw new Error(`GET ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);

      return { data: (response.status === 204 ? undefined : await response.json()) as T, headers: response.headers };
    }
  },
  // The GraphQL Admin API (translations) is a POST that only reads; every other write is refused.
  async post<T>(path: string, options: { body?: unknown } = {}): Promise<ApiResponse<T>> {
    if (path !== "/graphql" || /\bmutation\b/i.test(String((options.body as { query?: string } | undefined)?.query ?? ""))) throw new Error("capture is read-only");

    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "X-Auth-Token": token, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(options.body) });

    if (!response.ok) throw new Error(`POST ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);

    return { data: (await response.json()) as T, headers: response.headers };
  },
  async put() { throw new Error("capture is read-only"); },
  async delete() { throw new Error("capture is read-only"); },
});
const client = readOnlyClient(`https://api.bigcommerce.com/stores/${storeHash}`);

const storeName = await client.get<{ name?: string }>("/v2/store").then((response) => response.data.name ?? null).catch(() => null);

const result = await captureCatalogSample(client, {
  name,
  slug: flag("slug"),
  description: flag("description"),
  tags: flag("tags")?.split(",").map((tag) => tag.trim()).filter(Boolean),
  notes: flag("notes"),
  // e.g. --sections shipping,tax (the catalog is always captured)
  sections: flag("sections")?.split(",").map((id) => id.trim()).filter(Boolean) as SampleSectionId[] | undefined,
  storeName,
  b2b: async () => readOnlyClient("https://api-b2b.bigcommerce.com/api/v3/io"),
  readExisting: async (path) => {
    const file = join(out, path);

    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  },
  fetchImage: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);

    return response?.ok ? { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get("content-type") ?? "" } : undefined;
  },
});

for (const [path, contents] of result.files) {
  const file = join(out, path);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

console.log(`Captured ${result.counts.products} products, ${result.counts.categories} categories and ${result.counts.images} images as ${result.slug} ${result.version}.`);
if (result.warnings.length) console.log(`${result.warnings.length} warnings, e.g. ${result.warnings[0]}`);
console.log(`\nWritten to ${out}. To publish it:\n  cd ${out} && git add -A && git commit -m "Add ${result.slug} ${result.version}" && git push`);
