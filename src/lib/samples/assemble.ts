// Turns store-agnostic products into the files of a sample version (see format.ts). Shared by the
// capture script (products read from a BigCommerce store) and the snapshot download (products
// read from a saved pack), so both produce exactly the same layout. Free of server-only code and of
// node-only APIs, so it also runs in the browser.
import type { PackProduct } from "@/lib/app-data/types";
import type { PackProductRaw } from "@/lib/catalog/pack-mapper";
import {
  chunkName,
  imagePath,
  INDEX_PATH,
  nextVersion,
  PRODUCTS_PER_CHUNK,
  SAMPLE_FORMAT_VERSION,
  samplePath,
  slugify,
  versionPath,
  type ProductSummary,
  type SampleCatalogFile,
  type SampleIndex,
  type SampleIndexEntry,
  type SampleManifest,
  type SampleMeta,
  type SampleProduct,
  type SampleSectionId,
} from "@/lib/samples/format";

export interface AssembleOptions {
  name: string;
  slug?: string;
  description?: string;
  tags?: string[];
  // What changed in this version, shown in the version history.
  notes?: string;
  defaultLanguage?: string;
  storeName?: string | null;
  // Reads a file already in the repo (for the index and the version list), or undefined if it isn't there.
  readExisting: (path: string) => Promise<string | undefined>;
  // Downloads a product image. Returns undefined if it can't be fetched.
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | undefined>;
  // Lower-case hex SHA-256 of the bytes (node:crypto on the server, crypto.subtle in the browser).
  sha256: (bytes: Uint8Array) => Promise<string>;
  now?: () => Date;
}

export interface AssembleInput {
  // Pictures are in raw.images[].url; they are replaced by files in images/.
  products: PackProduct[];
  // "Parent > Child", every category the products use plus its ancestors.
  categoryPaths: string[];
  brands: string[];
  // Sections beside the catalog that were captured already, written as <section>.json.
  sections?: Partial<Record<SampleSectionId, { data: unknown; warnings: string[] }>>;
  // Notes to carry into the result, e.g. a section that couldn't be captured.
  warnings?: string[];
}

export interface AssembleResult {
  slug: string;
  version: string;
  // Repo path -> contents. Images are bytes, everything else is text.
  files: Map<string, string | Uint8Array>;
  warnings: string[];
  counts: { products: number; categories: number; images: number };
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

function extensionFor(mime: string, url: string): string | undefined {
  const fromMime = EXTENSIONS[mime.split(";")[0].trim().toLowerCase()];

  if (fromMime) return fromMime;

  const fromUrl = url.split("?")[0].split(".").pop()?.toLowerCase();

  return fromUrl && ["jpg", "jpeg", "png", "webp", "gif"].includes(fromUrl) ? (fromUrl === "jpeg" ? "jpg" : fromUrl) : undefined;
}

const parseJson = <T>(text: string | undefined): T | undefined => {
  if (!text) return undefined;

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

export async function assembleSample(input: AssembleInput, options: AssembleOptions): Promise<AssembleResult> {
  const slug = options.slug ?? slugify(options.name);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const warnings: string[] = [...(input.warnings ?? [])];
  const files = new Map<string, string | Uint8Array>();

  if (input.products.length === 0) throw new Error("There are no products to put in the sample.");

  // Images are stored once by content hash, so a picture used by many products (or samples) is one file.
  const imageFiles = new Map<string, string>();
  const download = async (url: string): Promise<string | undefined> => {
    const known = imageFiles.get(url);

    if (known) return known;

    const image = await options.fetchImage(url).catch(() => undefined);
    const extension = image ? extensionFor(image.mime, url) : undefined;

    if (!image || !extension) return undefined;

    const file = `${await options.sha256(image.bytes)}.${extension}`;

    files.set(imagePath(file), image.bytes);
    imageFiles.set(url, file);

    return file;
  };

  const sampleProducts: SampleProduct[] = [];

  for (const product of input.products) {
    const raw = product.raw as unknown as PackProductRaw;
    const images: PackProductRaw["images"] = [];

    for (const image of raw.images ?? []) {
      const file = await download(image.url);

      if (file) images.push({ ...image, url: "", file });
      else warnings.push(`${product.name}: couldn't download ${image.url}`);
    }

    sampleProducts.push({ ...product, imageUrls: [], raw: { ...product.raw, images } as unknown as Record<string, unknown> });
  }

  const catalog: SampleCatalogFile = {
    categories: [...new Set(input.categoryPaths)].sort().map((path, index) => ({ path, description: "", sortOrder: index })),
    brands: [...new Set(input.brands)].sort(),
    products: sampleProducts.map((product, index): ProductSummary => {
      const raw = product.raw as unknown as PackProductRaw;

      return { index, name: product.name, sku: product.sku, price: product.price, image: raw.images[0]?.file ?? null, categories: product.categoryPaths, variants: raw.variants?.length ?? 0, modifiers: raw.modifiers?.length ?? 0, customFields: raw.customFields?.length ?? 0 };
    }),
    chunks: [],
  };

  for (let start = 0, file = 0; start < sampleProducts.length; start += PRODUCTS_PER_CHUNK, file += 1) {
    catalog.chunks.push(chunkName(file));
  }

  const existingMeta = parseJson<SampleMeta>(await options.readExisting(samplePath(slug, "sample.json")));
  const version = nextVersion(existingMeta?.versions.map((entry) => entry.version) ?? []);

  catalog.chunks.forEach((name, file) => files.set(versionPath(slug, version, "catalog", name), JSON.stringify(sampleProducts.slice(file * PRODUCTS_PER_CHUNK, (file + 1) * PRODUCTS_PER_CHUNK))));
  files.set(versionPath(slug, version, "catalog.json"), JSON.stringify(catalog));

  const extra: Partial<SampleManifest["sections"]> = {};

  for (const [id, captured] of Object.entries(input.sections ?? {}) as [SampleSectionId, { data: unknown; warnings: string[] }][]) {
    files.set(versionPath(slug, version, `${id}.json`), JSON.stringify(captured.data));
    extra[id] = { file: `${id}.json`, warnings: captured.warnings.slice(0, 20) };
    warnings.push(...captured.warnings.map((warning) => `${id}: ${warning}`));
  }

  // Languages the localization section knows about make the sample's language list.
  const localization = input.sections?.localization?.data as { languages?: string[]; defaultLanguage?: string } | undefined;
  const manifest: SampleManifest = {
    formatVersion: SAMPLE_FORMAT_VERSION,
    slug,
    version,
    capturedAt: now,
    source: { storeName: options.storeName ?? null },
    defaultLanguage: options.defaultLanguage ?? localization?.defaultLanguage ?? existingMeta?.defaultLanguage ?? "en",
    sections: { catalog: { file: "catalog.json", counts: { products: sampleProducts.length, categories: catalog.categories.length, brands: catalog.brands.length }, warnings: warnings.filter((warning) => !/^[a-z]+: /.test(warning) || warning.includes("couldn't download")).slice(0, 20) }, ...extra },
    images: imageFiles.size,
  };

  files.set(versionPath(slug, version, "manifest.json"), JSON.stringify(manifest, null, 2));

  const meta: SampleMeta = {
    slug,
    name: options.name,
    description: options.description ?? existingMeta?.description ?? "",
    tags: options.tags ?? existingMeta?.tags ?? [],
    latest: version,
    defaultLanguage: manifest.defaultLanguage,
    languages: [...new Set([...(existingMeta?.languages ?? []), manifest.defaultLanguage, ...(localization?.languages ?? [])])],
    versions: [...(existingMeta?.versions ?? []), { version, date: now, notes: options.notes ?? "", formatVersion: SAMPLE_FORMAT_VERSION, sections: Object.keys(manifest.sections) as SampleSectionId[], products: sampleProducts.length }],
  };

  files.set(samplePath(slug, "sample.json"), JSON.stringify(meta, null, 2));

  const index = parseJson<SampleIndex>(await options.readExisting(INDEX_PATH)) ?? { format: SAMPLE_FORMAT_VERSION, samples: [] };
  const entry: SampleIndexEntry = {
    slug,
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    latest: version,
    updatedAt: now,
    products: sampleProducts.length,
    categories: catalog.categories.length,
    preview: [...new Set(catalog.products.map((product) => product.image).filter((file): file is string => file !== null))].slice(0, 4),
    sections: Object.keys(manifest.sections) as SampleSectionId[],
    languages: meta.languages,
  };

  files.set(INDEX_PATH, JSON.stringify({ format: SAMPLE_FORMAT_VERSION, samples: [...index.samples.filter((sample) => sample.slug !== slug), entry].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));

  return { slug, version, files, warnings, counts: { products: sampleProducts.length, categories: catalog.categories.length, images: imageFiles.size } };
}
