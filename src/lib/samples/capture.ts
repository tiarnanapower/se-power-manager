// Turns a BigCommerce store into the files of a sample version (see format.ts). Used by the capture
// script; kept free of server-only code so it can be tested and run outside Next.
import { createHash } from "node:crypto";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { fetchBrands, fetchCategories, fetchProducts } from "@/lib/catalog/catalog-api";
import { buildCategoryPaths, toPackProduct, type PackProductRaw } from "@/lib/catalog/pack-mapper";
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
} from "@/lib/samples/format";

export interface CaptureOptions {
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
  fetchImage: (url: string) => Promise<{ bytes: Buffer; mime: string } | undefined>;
  now?: () => Date;
}

export interface CaptureResult {
  slug: string;
  version: string;
  // Repo path -> contents. Images are Buffers, everything else is text.
  files: Map<string, string | Buffer>;
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

export async function captureCatalogSample(client: BcRestApiClient, options: CaptureOptions): Promise<CaptureResult> {
  const slug = options.slug ?? slugify(options.name);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const warnings: string[] = [];
  const files = new Map<string, string | Buffer>();

  const [products, categories, brands] = await Promise.all([fetchProducts(client), fetchCategories(client), fetchBrands(client)]);

  if (products.length === 0) throw new Error("The store has no products to capture.");

  const context = {
    categoryPaths: buildCategoryPaths(categories),
    brandNames: new Map(brands.map((brand) => [brand.id, brand.name])),
    productRefs: new Map(products.map((product) => [product.id, { sku: typeof product.sku === "string" && product.sku ? product.sku : null, name: product.name }])),
  };

  // Images are stored once by content hash, so a picture used by many products (or samples) is one file.
  const imageFiles = new Map<string, string>();
  const download = async (url: string): Promise<string | undefined> => {
    const known = imageFiles.get(url);

    if (known) return known;

    const image = await options.fetchImage(url).catch(() => undefined);
    const extension = image ? extensionFor(image.mime, url) : undefined;

    if (!image || !extension) return undefined;

    const file = `${createHash("sha256").update(image.bytes).digest("hex")}.${extension}`;

    files.set(imagePath(file), image.bytes);
    imageFiles.set(url, file);

    return file;
  };

  const sampleProducts: SampleProduct[] = [];

  for (const product of products) {
    const packProduct = toPackProduct(product, context);
    const raw = packProduct.raw as unknown as PackProductRaw;
    const images: PackProductRaw["images"] = [];

    for (const image of raw.images) {
      const file = await download(image.url);

      if (file) images.push({ ...image, url: "", file });
      else warnings.push(`${product.name}: couldn't download ${image.url}`);
    }

    sampleProducts.push({ ...packProduct, imageUrls: [], raw: { ...packProduct.raw, images } as unknown as Record<string, unknown> });
  }

  const catalog: SampleCatalogFile = {
    categories: [...context.categoryPaths.values()].sort().map((path, index) => ({ path, description: "", sortOrder: index })),
    brands: [...new Set(brands.map((brand) => brand.name))].sort(),
    products: sampleProducts.map((product, index): ProductSummary => {
      const raw = product.raw as unknown as PackProductRaw;

      return { index, name: product.name, sku: product.sku, price: product.price, image: raw.images[0]?.file ?? null, categories: product.categoryPaths, variants: raw.variants.length, modifiers: raw.modifiers.length, customFields: raw.customFields.length };
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

  const manifest: SampleManifest = {
    formatVersion: SAMPLE_FORMAT_VERSION,
    slug,
    version,
    capturedAt: now,
    source: { storeName: options.storeName ?? null },
    defaultLanguage: options.defaultLanguage ?? existingMeta?.defaultLanguage ?? "en",
    sections: { catalog: { file: "catalog.json", counts: { products: sampleProducts.length, categories: catalog.categories.length, brands: catalog.brands.length }, warnings: warnings.slice(0, 20) } },
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
    languages: existingMeta?.languages ?? [manifest.defaultLanguage],
    versions: [...(existingMeta?.versions ?? []), { version, date: now, notes: options.notes ?? "", formatVersion: SAMPLE_FORMAT_VERSION, sections: ["catalog"], products: sampleProducts.length }],
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
    sections: ["catalog"],
    languages: meta.languages,
  };

  files.set(INDEX_PATH, JSON.stringify({ format: SAMPLE_FORMAT_VERSION, samples: [...index.samples.filter((sample) => sample.slug !== slug), entry].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));

  return { slug, version, files, warnings, counts: { products: sampleProducts.length, categories: catalog.categories.length, images: imageFiles.size } };
}
