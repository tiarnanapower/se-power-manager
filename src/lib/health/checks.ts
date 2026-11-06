// Catalog health checks. Pure functions over product records, so they can be
// tested without a store; scan.ts fetches the records.

export type Severity = "issue" | "warning" | "info";

export interface HealthProduct {
  id: number;
  name: string;
  sku?: string | null;
  type?: string;
  price?: number | null;
  description?: string | null;
  is_visible?: boolean;
  brand_id?: number | null;
  categories?: number[];
  inventory_level?: number | null;
  inventory_tracking?: string;
  page_title?: string | null;
  meta_description?: string | null;
  primary_image?: unknown;
}

export interface CheckDefinition {
  id: string;
  label: string;
  severity: Severity;
  // What the problem means for the storefront, in one sentence.
  description: string;
  // Where to go to fix it, when this app has a tool for it.
  fix?: { label: string; path: string };
  test: (product: HealthProduct, context: HealthContext) => boolean;
}

export interface HealthContext {
  duplicateSkus: Set<string>;
  duplicateNames: Set<string>;
  // Product ids assigned to at least one channel; undefined when the store's assignments weren't read.
  channelAssigned: Set<number> | undefined;
}

const words = (text: string | null | undefined) => (text ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const key = (text: string | null | undefined) => (text ?? "").trim().toLowerCase();

export const CHECKS: CheckDefinition[] = [
  { id: "no-image", label: "No product image", severity: "issue", description: "Products without a picture look broken and rarely sell.", test: (p) => !p.primary_image },
  { id: "no-description", label: "Missing or very short description", severity: "issue", description: "Under 20 characters of text, which hurts conversion and search.", fix: { label: "Improve with Enrich Tool", path: "catalog/enrich" }, test: (p) => words(p.description).length < 20 },
  { id: "bad-price", label: "Price is zero or missing", severity: "issue", description: "These can be bought for nothing or shown as free.", test: (p) => !(typeof p.price === "number" && p.price > 0) },
  { id: "duplicate-sku", label: "Duplicate SKU", severity: "issue", description: "More than one product shares a SKU, which breaks syncing and imports.", test: (p, c) => Boolean(p.sku) && c.duplicateSkus.has(key(p.sku)) },
  { id: "no-category", label: "Not in any category", severity: "warning", description: "Shoppers can't find these by browsing.", test: (p) => !p.categories || p.categories.length === 0 },
  { id: "no-sku", label: "No SKU", severity: "warning", description: "Needed for stock, orders and most integrations.", test: (p) => !p.sku?.trim() },
  { id: "duplicate-name", label: "Duplicate product name", severity: "warning", description: "Identical names confuse search results and customers.", test: (p, c) => c.duplicateNames.has(key(p.name)) },
  { id: "out-of-stock", label: "Out of stock", severity: "warning", description: "Stock is tracked and has run out.", test: (p) => p.inventory_tracking === "product" && (p.inventory_level ?? 0) <= 0 },
  { id: "no-channel", label: "Not on any channel", severity: "warning", description: "Not assigned to a storefront channel, so it can't be sold anywhere.", test: (p, c) => c.channelAssigned !== undefined && !c.channelAssigned.has(p.id) },
  { id: "hidden", label: "Hidden from the storefront", severity: "info", description: "Not visible to shoppers. Fine if it's intentional.", test: (p) => p.is_visible === false },
  { id: "no-brand", label: "No brand", severity: "info", description: "Brand pages and filters skip these.", test: (p) => !p.brand_id },
  { id: "no-seo", label: "No SEO title or meta description", severity: "info", description: "Search engines will guess the snippet.", fix: { label: "Improve with Enrich Tool", path: "catalog/enrich" }, test: (p) => !words(p.page_title) && !words(p.meta_description) },
];

export interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  description: string;
  fix?: { label: string; path: string };
  count: number;
  // The first few affected products, for the list.
  samples: { id: number; name: string }[];
}

export interface HealthReport {
  total: number;
  // Percentage of products with no issue or warning (info findings don't count).
  score: number;
  checks: CheckResult[];
}

const SAMPLE_SIZE = 25;

function duplicates(values: (string | null | undefined)[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const value of values) {
    const k = key(value);

    if (!k) continue;
    if (seen.has(k)) repeated.add(k);
    seen.add(k);
  }

  return repeated;
}

export function evaluateHealth(products: HealthProduct[], channelAssigned?: Set<number>): HealthReport {
  const context: HealthContext = { duplicateSkus: duplicates(products.map((p) => p.sku)), duplicateNames: duplicates(products.map((p) => p.name)), channelAssigned };
  const flagged = new Set<number>();
  const checks = CHECKS.map((check): CheckResult => {
    const hits = products.filter((product) => check.test(product, context));

    if (check.severity !== "info") for (const product of hits) flagged.add(product.id);

    return { id: check.id, label: check.label, severity: check.severity, description: check.description, fix: check.fix, count: hits.length, samples: hits.slice(0, SAMPLE_SIZE).map((product) => ({ id: product.id, name: product.name })) };
  });

  return { total: products.length, score: products.length === 0 ? 100 : Math.round(((products.length - flagged.size) / products.length) * 100), checks };
}
