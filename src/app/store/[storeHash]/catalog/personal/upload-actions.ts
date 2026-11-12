"use server";

import { z } from "zod";
import { type Outcome, runStoreAction } from "@/lib/actions/run-action";
import { finishPickLists } from "@/lib/catalog/pick-lists";
import { restoreProducts, type RestoreBatchResult } from "@/lib/catalog/operations";
import { AppError } from "@/lib/errors/app-error";
import { isImageFile, isLocale, SAMPLE_SECTIONS } from "@/lib/samples/format";
import { isSectionModule } from "@/lib/samples/sections";
import { runSectionImport } from "@/lib/samples/sections/run";
import type { SectionResult } from "@/lib/samples/sections/shared";

// Actions for an uploaded snapshot. The files live in the browser, so each request carries the few
// products it needs and their pictures (kept small enough for one request) instead of reading a repo.

const productSchema = z.object({
  name: z.string().max(300),
  sku: z.string().max(255).nullable(),
  price: z.number().nullable(),
  description: z.string().nullable(),
  imageUrls: z.array(z.string().max(2000)).max(50),
  categoryPaths: z.array(z.string().max(500)).max(50),
  raw: z.record(z.string(), z.unknown()),
});
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const label = z.string().trim().max(160);

export async function importUploadBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: RestoreBatchResult }>> {
  const parsed = z.object({
    label,
    total: z.number().int().min(0).max(100_000),
    offset: z.number().int().min(0).max(100_000),
    products: z.array(productSchema).min(1).max(25),
    images: z.array(z.object({ file: z.string().refine(isImageFile), base64: z.string().max(6_000_000) })).max(120),
  }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "That batch of the snapshot isn't valid." };

  return runStoreAction(storeHash, "importUploadBatchAction", async (ctx) => {
    const { products, images, total, offset } = parsed.data;
    const pictures = new Map(images.map((image) => [image.file, Buffer.from(image.base64, "base64")]));
    const batch = await restoreProducts(ctx, {
      label: `uploaded snapshot "${parsed.data.label}"`,
      total,
      offset,
      products,
      packId: null,
      activityKind: "snapshots.import",
      loadImage: async (file) => {
        const bytes = pictures.get(file);

        if (!bytes) throw new AppError("NOT_FOUND", "That picture wasn't in the upload.", { detail: "That picture wasn't in the upload." });

        return { bytes, mime: MIME[file.split(".").pop() ?? ""] ?? "image/jpeg", filename: file };
      },
    });

    batch.done = batch.nextOffset >= total;

    return { batch };
  });
}

// Only the products that have pick lists are sent; the rest have nothing to link.
export async function finishUploadPickListsAction(storeHash: unknown, input: unknown): Promise<Outcome<{ created: number; warnings: { name: string; detail: string }[] }>> {
  const parsed = z.object({ products: z.array(productSchema).max(40) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "finishUploadPickListsAction", async (ctx) => {
    const result = await finishPickLists(ctx.client, parsed.data.products);

    return { created: result.done, warnings: result.warnings };
  });
}

export async function importUploadSectionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ result: SectionResult }>> {
  const parsed = z.object({ label, section: z.string().refine((id) => SAMPLE_SECTIONS.some((section) => section.id === id) && isSectionModule(id)), data: z.unknown(), defaultLanguage: z.string().refine(isLocale).optional() }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "That section can't be imported yet." };

  return runStoreAction(storeHash, "importUploadSectionAction", async (ctx) => ({ result: await runSectionImport(ctx, parsed.data.section, parsed.data.data, `uploaded snapshot "${parsed.data.label}"`, { defaultLanguage: parsed.data.defaultLanguage }) }));
}
