// The layout of the sample-data GitHub repo, and the types for what is stored in it. Shared by
// the capture script (which writes it) and the app (which only reads it), so it must not import
// anything server-only.
//
//   catalog.json                          index of every sample
//   samples/<slug>/sample.json            name, description, tags, languages, version list
//   samples/<slug>/<version>/manifest.json
//   samples/<slug>/<version>/catalog.json categories, brands and a light summary of each product
//   samples/<slug>/<version>/catalog/products-0001.json   full products, 100 per file
//   samples/<slug>/<version>/<section>.json               shipping, tax, pricing, ... (one file each)
//   samples/<slug>/<version>/i18n/<locale>.json           translations
//   images/<sha256>.<ext>                 every product image, shared by all samples
import type { PackProduct } from "@/lib/app-data/types";

// Bump when a change would break older readers. The app refuses newer formats with a clear message.
export const SAMPLE_FORMAT_VERSION = 1;
export const PRODUCTS_PER_CHUNK = 100;

// The sections an SE can pick when importing, in the order shown. `catalog` is always on by default.
export const SAMPLE_SECTIONS = [
  { id: "catalog", label: "Catalog", description: "Categories, brands, products, variants, options, custom fields, pick lists and images.", defaultChecked: true, implemented: true },
  { id: "shipping", label: "Shipping", description: "Shipping zones and their methods.", defaultChecked: false, implemented: true },
  { id: "tax", label: "Tax", description: "Tax zones, rates and settings.", defaultChecked: false, implemented: true },
  { id: "pricing", label: "Pricing & currencies", description: "Currencies, price lists and their prices. Prices find their products by SKU, so import the catalog first.", defaultChecked: false, implemented: true },
  { id: "storefront", label: "Storefront settings", description: "SEO, search, product and category display, robots.txt, security and catalog settings. Replaces the store's current values.", defaultChecked: false, implemented: true },
  { id: "checkout", label: "Checkout & customer experience", description: "Checkout, cart and abandoned-cart settings. Replaces the store's current values.", defaultChecked: false, implemented: true },
  { id: "inventory", label: "Inventory & locations", description: "Inventory settings and stock locations. Replaces the store's inventory settings.", defaultChecked: false, implemented: true },
  { id: "b2b", label: "B2B Edition", description: "Companies and their users. Quotes, orders and custom roles aren't included. Needs B2B Edition on the store.", defaultChecked: false, implemented: true },
  { id: "localization", label: "Localization", description: "Languages per channel, the default language, and product translations. Products are found by SKU, so import the catalog first.", defaultChecked: false, implemented: true },
] as const;

export type SampleSectionId = (typeof SAMPLE_SECTIONS)[number]["id"];

export const sectionLabel = (id: string): string => SAMPLE_SECTIONS.find((section) => section.id === id)?.label ?? id;

// ---- Index (catalog.json at the repo root) ------------------------------------------------------

export interface SampleIndexEntry {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  latest: string;
  updatedAt: string;
  products: number;
  categories: number;
  // Image file names (in images/) for the card preview, up to four.
  preview: string[];
  sections: SampleSectionId[];
  languages: string[];
}

export interface SampleIndex {
  format: number;
  samples: SampleIndexEntry[];
}

// ---- Per sample (samples/<slug>/sample.json) ----------------------------------------------------

export interface SampleVersionEntry {
  version: string; // "v1", "v2"
  date: string;
  notes: string;
  formatVersion: number;
  sections: SampleSectionId[];
  products: number;
}

export interface SampleMeta {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  latest: string;
  defaultLanguage: string;
  languages: string[];
  versions: SampleVersionEntry[];
}

// ---- Per version --------------------------------------------------------------------------------

export interface SampleManifest {
  formatVersion: number;
  slug: string;
  version: string;
  capturedAt: string;
  // Where it was captured from. A name only: never credentials.
  source: { storeName: string | null };
  defaultLanguage: string;
  sections: Partial<Record<SampleSectionId, { file: string; counts?: Record<string, number>; warnings?: string[] }>>;
  images: number;
}

export interface SampleCategory {
  // "Parent > Child"
  path: string;
  description: string;
  sortOrder: number;
}

export interface ProductSummary {
  // Position in the sample, used to find the product's chunk.
  index: number;
  name: string;
  sku: string | null;
  price: number | null;
  image: string | null;
  categories: string[];
  variants: number;
  modifiers: number;
  customFields: number;
}

export interface SampleCatalogFile {
  categories: SampleCategory[];
  brands: string[];
  products: ProductSummary[];
  // Chunk files under catalog/, each holding PRODUCTS_PER_CHUNK full products in order.
  chunks: string[];
}

// A product as stored in a chunk: the store-agnostic pack shape, with images referring to
// files in images/ instead of source-store URLs.
export type SampleProduct = PackProduct;

export function chunkFor(index: number): { file: number; offset: number } {
  return { file: Math.floor(index / PRODUCTS_PER_CHUNK), offset: index % PRODUCTS_PER_CHUNK };
}

export const chunkName = (file: number) => `products-${String(file + 1).padStart(4, "0")}.json`;

// ---- Paths --------------------------------------------------------------------------------------

export const INDEX_PATH = "catalog.json";
export const samplePath = (slug: string, ...rest: string[]) => ["samples", slug, ...rest].join("/");
export const versionPath = (slug: string, version: string, ...rest: string[]) => ["samples", slug, version, ...rest].join("/");
export const imagePath = (file: string) => `images/${file}`;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^v\d{1,4}$/;
const IMAGE_FILE = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export const isSlug = (value: unknown): value is string => typeof value === "string" && SLUG.test(value);
export const isVersion = (value: unknown): value is string => typeof value === "string" && VERSION.test(value);
export const isImageFile = (value: unknown): value is string => typeof value === "string" && IMAGE_FILE.test(value);
export const isLocale = (value: unknown): value is string => typeof value === "string" && LOCALE.test(value);

export const slugify = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "sample";

export function nextVersion(existing: string[]): string {
  const numbers = existing.map((version) => Number(version.slice(1))).filter(Number.isFinite);

  return `v${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

export function assertSupportedFormat(formatVersion: number): void {
  if (formatVersion > SAMPLE_FORMAT_VERSION) throw new Error(`This sample uses format ${formatVersion}, but this version of the app reads format ${SAMPLE_FORMAT_VERSION} and older. Update the app to use it.`);
}
