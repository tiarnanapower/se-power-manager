// Turns a BigCommerce store into the files of a sample version (see format.ts). Used by the capture
// script; kept free of server-only code so it can be tested and run outside Next.
import { createHash } from "node:crypto";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { fetchBrands, fetchCategories, fetchProducts } from "@/lib/catalog/catalog-api";
import { buildCategoryPaths, toPackProduct } from "@/lib/catalog/pack-mapper";
import { assembleSample, type AssembleResult } from "@/lib/samples/assemble";
import { SECTION_MODULES } from "@/lib/samples/sections";
import type { SampleSectionId } from "@/lib/samples/format";

export interface CaptureOptions {
  name: string;
  slug?: string;
  description?: string;
  tags?: string[];
  // What changed in this version, shown in the version history.
  notes?: string;
  defaultLanguage?: string;
  // Sections to capture besides the catalog, e.g. ["shipping", "tax"].
  sections?: SampleSectionId[];
  storeName?: string | null;
  // Reads a file already in the repo (for the index and the version list), or undefined if it isn't there.
  readExisting: (path: string) => Promise<string | undefined>;
  // Downloads a product image. Returns undefined if it can't be fetched.
  fetchImage: (url: string) => Promise<{ bytes: Buffer; mime: string } | undefined>;
  now?: () => Date;
}

export type CaptureResult = AssembleResult;

export async function captureCatalogSample(client: BcRestApiClient, options: CaptureOptions): Promise<CaptureResult> {
  const [products, categories, brands] = await Promise.all([fetchProducts(client), fetchCategories(client), fetchBrands(client)]);

  if (products.length === 0) throw new Error("The store has no products to capture.");

  const context = {
    categoryPaths: buildCategoryPaths(categories),
    brandNames: new Map(brands.map((brand) => [brand.id, brand.name])),
    productRefs: new Map(products.map((product) => [product.id, { sku: typeof product.sku === "string" && product.sku ? product.sku : null, name: product.name }])),
  };
  const sections: NonNullable<Parameters<typeof assembleSample>[0]["sections"]> = {};
  const warnings: string[] = [];

  for (const id of options.sections ?? []) {
    const sectionModule = id === "catalog" ? undefined : SECTION_MODULES[id];

    if (!sectionModule) {
      warnings.push(`${id}: capturing this section isn't supported yet`);
      continue;
    }

    sections[id] = await sectionModule.capture(client);
  }

  return assembleSample(
    { products: products.map((product) => toPackProduct(product, context)), categoryPaths: [...context.categoryPaths.values()], brands: brands.map((brand) => brand.name), sections, warnings },
    { ...options, sha256: async (bytes) => createHash("sha256").update(bytes).digest("hex") },
  );
}
