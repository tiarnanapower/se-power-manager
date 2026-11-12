"use server";

import { z } from "zod";
import { type Outcome, runLocalAction, runStoreAction } from "@/lib/actions/run-action";
import { finishPickLists } from "@/lib/catalog/pick-lists";
import { RESTORE_BATCH_SIZE, restoreProducts, type RestoreBatchResult } from "@/lib/catalog/operations";
import { getImage, getProduct, getProducts, getSectionFile, getVersion } from "@/lib/samples/library";
import { isSectionModule } from "@/lib/samples/sections";
import { runSectionImport } from "@/lib/samples/sections/run";
import type { SectionResult } from "@/lib/samples/sections/shared";
import { isSlug, isVersion, SAMPLE_SECTIONS, type SampleProduct } from "@/lib/samples/format";
import { AppError } from "@/lib/errors/app-error";

const target = z.object({ slug: z.string().refine(isSlug), version: z.string().refine(isVersion) });
const IMAGE_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// The full record of one product, for the popup on the sample's page. Reads only the samples repo.
export async function getSampleProductAction(storeHash: unknown, input: unknown): Promise<Outcome<{ product: SampleProduct }>> {
  const parsed = target.extend({ index: z.number().int().min(0).max(100_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "getSampleProductAction", async () => {
    const product = await getProduct(parsed.data.slug, parsed.data.version, parsed.data.index);

    if (!product) throw new AppError("NOT_FOUND", "That product isn't in this version.", { detail: "That product isn't in this version." });

    return { product };
  });
}

// Imports one slice of a sample's products into the SE's store. The dialog calls this repeatedly with
// `nextOffset` until `done`, so no request outlasts the platform's time limit.
export async function importSampleBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: RestoreBatchResult }>> {
  const parsed = target.extend({ offset: z.number().int().min(0) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "importSampleBatchAction", async (ctx) => {
    const { slug, version, offset } = parsed.data;
    const bundle = await getVersion(slug, version);
    const total = bundle.catalog?.products.length ?? 0;

    if (!bundle.catalog) throw new AppError("VALIDATION", "This version has no catalog.", { detail: "This version of the sample has no catalog to import." });

    const products = await getProducts(slug, version, offset, RESTORE_BATCH_SIZE);
    const batch = await restoreProducts(ctx, {
      label: `sample "${bundle.meta.name}" ${version}`,
      total,
      offset,
      products,
      packId: null,
      activityKind: "samples.import",
      loadImage: async (file) => ({ bytes: await getImage(file), mime: IMAGE_MIME[file.split(".").pop() ?? ""] ?? "image/jpeg", filename: file }),
    });

    batch.done = batch.nextOffset >= total || products.length === 0;

    return { batch };
  });
}

// The second pass: pick lists point at other products, so they are made once every product exists.
export async function finishSamplePickListsAction(storeHash: unknown, input: unknown): Promise<Outcome<{ nextOffset: number; total: number; done: boolean; created: number; warnings: { name: string; detail: string }[] }>> {
  const parsed = target.extend({ offset: z.number().int().min(0) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "finishSamplePickListsAction", async (ctx) => {
    const { slug, version, offset } = parsed.data;
    const bundle = await getVersion(slug, version);
    const total = bundle.catalog?.products.length ?? 0;
    const products = await getProducts(slug, version, offset, RESTORE_BATCH_SIZE * 2);
    const result = await finishPickLists(ctx.client, products);
    const nextOffset = offset + products.length;

    return { nextOffset, total, done: nextOffset >= total || products.length === 0, created: result.done, warnings: result.warnings };
  });
}

// Which sections of this version the importer can bring in, for the dialog.
export async function listImportableSectionsAction(storeHash: unknown, input: unknown): Promise<Outcome<{ sections: { id: string; present: boolean }[] }>> {
  const parsed = target.safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "listImportableSectionsAction", async () => {
    const { manifest } = await getVersion(parsed.data.slug, parsed.data.version);

    return { sections: SAMPLE_SECTIONS.map((section) => ({ id: section.id, present: Boolean(manifest.sections[section.id]) })) };
  });
}

// Imports one non-catalog section (shipping, tax, ...). These are small, so one request does the section.
export async function importSampleSectionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ result: SectionResult }>> {
  const parsed = target.extend({ section: z.string() }).safeParse(input);

  if (!parsed.success || !isSectionModule(parsed.data.section)) return { ok: false, message: "That section can't be imported yet." };

  return runStoreAction(storeHash, "importSampleSectionAction", async (ctx) => {
    const { slug, version, section } = parsed.data;
    const { manifest } = await getVersion(slug, version);
    const entry = manifest.sections[section as keyof typeof manifest.sections];

    if (!entry) throw new AppError("VALIDATION", "Not in this sample.", { detail: "This version of the sample doesn't include that section." });

    const data = await getSectionFile<never>(slug, version, entry.file);

    return { result: await runSectionImport(ctx, section, data, `sample "${slug}" ${version}`) };
  });
}
