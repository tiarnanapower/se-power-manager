"use server";

import { z } from "zod";
import { type Outcome, runLocalAction, runStoreAction } from "@/lib/actions/run-action";
import type { PackProduct } from "@/lib/app-data/types";
import { fetchBrands, fetchCategories, fetchProductRefs, fetchProducts } from "@/lib/catalog/catalog-api";
import { buildCategoryPaths, toPackProduct } from "@/lib/catalog/pack-mapper";
import { assertPublicUrl } from "@/lib/import/safe-fetch";
import { isSlug } from "@/lib/samples/format";
import { getIndex, getSampleMeta } from "@/lib/samples/library";
import { SECTION_MODULES, isSectionModule } from "@/lib/samples/sections";

// Actions behind "Download a snapshot". The zip is put together in the browser, so each of these hands
// over one small piece of the store: a few products, one picture, one section.

const SNAPSHOT_PAGE = 20;
const IMAGE_LIMIT = 3 * 1024 * 1024;
const ref = z.tuple([z.number().int(), z.object({ sku: z.string().nullable(), name: z.string() })]);

// Which products to read, and what pick lists need to find other products again.
export async function planSnapshotAction(storeHash: unknown, input: unknown): Promise<Outcome<{ ids: number[]; refs: [number, { sku: string | null; name: string }][]; sections: string[] }>> {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).max(100_000).optional() }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "planSnapshotAction", async (ctx) => {
    const all = await fetchProductRefs(ctx.client);
    const wanted = parsed.data.ids ? new Set(parsed.data.ids) : undefined;

    return {
      ids: all.filter((product) => !wanted || wanted.has(product.id)).map((product) => product.id),
      refs: all.map((product): [number, { sku: string | null; name: string }] => [product.id, { sku: product.sku, name: product.name }]),
      sections: Object.keys(SECTION_MODULES),
    };
  });
}

export async function snapshotPageAction(storeHash: unknown, input: unknown): Promise<Outcome<{ products: PackProduct[] }>> {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(SNAPSHOT_PAGE), refs: z.array(ref).max(100_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "snapshotPageAction", async (ctx) => {
    const [products, categories, brands] = await Promise.all([fetchProducts(ctx.client, parsed.data.ids), fetchCategories(ctx.client), fetchBrands(ctx.client)]);
    const context = { categoryPaths: buildCategoryPaths(categories), brandNames: new Map(brands.map((brand) => [brand.id, brand.name])), productRefs: new Map(parsed.data.refs) };

    return { products: products.map((product) => toPackProduct(product, context)) };
  });
}

// One picture, as base64. Only pictures BigCommerce itself hosts can be fetched.
export async function snapshotImageAction(storeHash: unknown, input: unknown): Promise<Outcome<{ image: { base64: string; mime: string } | null }>> {
  const parsed = z.object({ url: z.string().url().max(2000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "snapshotImageAction", async () => {
    try {
      const url = await assertPublicUrl(parsed.data.url);

      if (url.protocol !== "https:" || !/(^|\.)(mybigcommerce|bigcommerce)\.com$/i.test(url.hostname)) return { image: null };

      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

      if (!response.ok || !mime.startsWith("image/")) return { image: null };

      const bytes = Buffer.from(await response.arrayBuffer());

      return bytes.length > 0 && bytes.length <= IMAGE_LIMIT ? { image: { base64: bytes.toString("base64"), mime } } : { image: null };
    } catch {
      return { image: null };
    }
  });
}

export async function snapshotSectionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ data: unknown; warnings: string[] }>> {
  const parsed = z.object({ section: z.string() }).safeParse(input);

  if (!parsed.success || !isSectionModule(parsed.data.section)) return { ok: false, message: "That section can't be saved yet." };

  const section = parsed.data.section;

  return runStoreAction(storeHash, "snapshotSectionAction", async (ctx) => {
    const captured = await SECTION_MODULES[section]!.capture(ctx.client);

    return { data: captured.data, warnings: captured.warnings };
  });
}

// What the templates repo already holds for this name, so a snapshot can be numbered as the next version
// of an existing template and its index updated.
export async function getRepoStateAction(storeHash: unknown, input: unknown): Promise<Outcome<{ index: string | null; meta: string | null }>> {
  const parsed = z.object({ slug: z.string().max(64) }).safeParse(input);

  if (!parsed.success || !isSlug(parsed.data.slug)) return { ok: false, message: "Use lower-case letters, numbers and dashes for the name in the repo." };

  const { slug } = parsed.data;

  return runLocalAction(storeHash, "getRepoStateAction", async () => {
    const index = await getIndex().catch(() => undefined);
    const meta = await getSampleMeta(slug).catch(() => undefined);

    return { index: index ? JSON.stringify(index) : null, meta: meta ? JSON.stringify(meta) : null };
  });
}
