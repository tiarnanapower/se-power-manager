"use server";

import { z } from "zod";
import { type Outcome, runLocalAction } from "@/lib/actions/run-action";
import type { PackSummary } from "@/lib/app-data/types";
import { MAX_SCRAPE_PRODUCTS, scrapeProducts, type ScrapedProduct } from "@/lib/import/scrape";
import { toPackProduct } from "@/lib/import/to-pack";

const httpUrl = z.string().trim().max(2000).url();
const shortText = (max: number) => z.string().trim().max(max);

const productSchema = z.object({
  name: shortText(250).min(1),
  price: z.number().min(0).max(1_000_000).nullable(),
  sku: shortText(255).nullable(),
  brand: shortText(100).nullable(),
  category: shortText(200).nullable(),
  description: shortText(4000),
  imageUrls: z.array(httpUrl).max(10),
  sourceUrl: httpUrl,
});

export async function scrapeUrlAction(storeHash: unknown, input: unknown): Promise<Outcome<{ products: ScrapedProduct[] }>> {
  const parsed = z.object({ url: httpUrl, limit: z.number().int().min(1).max(MAX_SCRAPE_PRODUCTS) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Enter a full web address, starting with https://." };

  return runLocalAction(storeHash, "scrapeUrlAction", async () => ({ products: await scrapeProducts(parsed.data.url, parsed.data.limit) }));
}

// Saves the reviewed products as a pack. Pushing to a store then reuses the
// restore flow with this pack's id.
export async function saveImportPackAction(storeHash: unknown, input: unknown): Promise<Outcome<{ pack: PackSummary }>> {
  const parsed = z.object({ name: shortText(120).min(1), products: z.array(productSchema).min(1).max(500) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Give the pack a name and keep at least one product." };

  return runLocalAction(storeHash, "saveImportPackAction", async ({ data, userEmail, storeHash: ownerStore }) => ({
    pack: await data.savePack({
      name: parsed.data.name,
      description: `Scraped from ${[...new Set(parsed.data.products.map((product) => new URL(product.sourceUrl).hostname))].join(", ")}`,
      source: "scrape",
      createdByEmail: userEmail,
      storeHash: ownerStore,
      products: parsed.data.products.map(toPackProduct),
    }),
  }));
}
