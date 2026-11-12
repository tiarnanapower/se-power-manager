// Restore and clear: the operations behind My Snapshots and the Import From External Site tool. Each takes an
// explicit context (client, data store, store hash, user) so Server Actions
// supply the real ones after authorizing, and tests supply fakes.
import type { AppDataStore, PackProduct } from "@/lib/app-data/types";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { countProducts, createModifiers, createProduct, fetchProductSummary, uploadProductImage, deleteProducts, fetchAllProductIds, fetchProductNames } from "@/lib/catalog/catalog-api";
import { checkImageReachable, dropDeadImages, type ImageCheck, looksLikeImageError, withoutImages } from "@/lib/catalog/images";
import { toCreatePayload, toModifierPayloads, type PackProductRaw } from "@/lib/catalog/pack-mapper";
import { assertCanUse, assertOwns } from "@/lib/catalog/pack-access";
import { NameResolver } from "@/lib/catalog/resolvers";
import { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION, RESTORE_BATCH_SIZE } from "@/lib/catalog/constants";
import { AppError } from "@/lib/errors/app-error";

export { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION, RESTORE_BATCH_SIZE };

export interface OpsContext {
  client: BcRestApiClient;
  data: AppDataStore;
  storeHash: string;
  userEmail: string | null;
  // Decides whether a pack image URL still exists. Tests replace it.
  imageCheck?: ImageCheck;
  // A client for the B2B Edition API, made when a section needs it.
  b2b?: () => Promise<BcRestApiClient>;
}

export type ClearScope = "all" | "demo";


// The same product with no image references, for products whose pictures are uploaded separately.
function withoutRawImages(product: PackProduct): PackProduct {
  return { ...product, imageUrls: [], raw: { ...product.raw, images: [] } };
}

function reasonFor(error: unknown): string {
  if (error instanceof AppError) {
    if (error.status === 409) return "A product with this SKU or name already exists.";

    return error.detail ?? error.message;
  }

  return "Unexpected error.";
}

// ---- Restore ---------------------------------------------------------------

export interface RestoreBatchResult {
  total: number;
  nextOffset: number;
  created: number;
  skipped: number;
  failed: number;
  // Products created, but without some images that no longer exist.
  imagesMissing: number;
  // Restored products whose images, variants or custom fields differ from the pack.
  differences: { name: string; detail: string }[];
  errors: { name: string; reason: string }[];
  done: boolean;
}

// Reads the restored product back and reports anything that didn't land.
// Best-effort: a failed read is not a failed restore.
async function compareRestored(client: BcRestApiClient, id: number, original: PackProduct, sent: PackProduct): Promise<string | null> {
  try {
    const actual = await fetchProductSummary(client, id);
    const raw = original.raw as unknown as Partial<PackProductRaw>;
    const expectedImages = sent.imageUrls.length;
    const problems: string[] = [];

    if (actual.images < expectedImages) problems.push(`${actual.images} of ${expectedImages} images`);
    if (actual.variants < (raw.variants?.length ?? 0)) problems.push(`${actual.variants} of ${raw.variants?.length} variants`);
    if (actual.customFields < (raw.customFields?.length ?? 0)) problems.push(`${actual.customFields} of ${raw.customFields?.length} custom fields`);

    return problems.length ? `only ${problems.join(", ")} came through` : null;
  } catch {
    return null;
  }
}

// Restores one slice of a pack. The UI calls this repeatedly with the returned
// `nextOffset` until `done`, so no single request has to outlast the platform's
// time limit.
export async function restoreBatch(ctx: OpsContext, options: { packId: string; offset: number; limit?: number }): Promise<RestoreBatchResult> {
  const { data, storeHash } = ctx;
  const limit = Math.min(options.limit ?? RESTORE_BATCH_SIZE, RESTORE_BATCH_SIZE);
  const page = await data.getPackPage(options.packId, options.offset, limit);

  if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.");

  assertCanUse(page.pack, storeHash);

  return restoreProducts(ctx, { label: `pack "${page.pack.name}"`, total: page.pack.productCount, offset: options.offset, products: page.products, packId: options.packId, activityKind: "catalog.restore" });
}

// Where a sample product's pictures come from. Set for samples, which keep images in the samples
// repo and upload them straight to BigCommerce.
export type ImageLoader = (file: string) => Promise<{ bytes: Buffer; mime: string; filename: string }>;

export interface RestoreSlice {
  // "pack \"x\"" or "sample \"x\" v2", for the activity log.
  label: string;
  total: number;
  offset: number;
  products: PackProduct[];
  // Set when the products come from a saved pack, so they are tracked for "clear demo products".
  packId: string | null;
  activityKind: string;
  loadImage?: ImageLoader;
}

// Creates one slice of products in the store: categories and brands by name, fallbacks for URLs and
// images BigCommerce refuses, then modifiers and a read-back check. Shared by packs and samples.
export async function restoreProducts(ctx: OpsContext, slice: RestoreSlice): Promise<RestoreBatchResult> {
  const { client, data, storeHash, userEmail } = ctx;
  const page = { products: slice.products };
  const options = { offset: slice.offset, packId: slice.packId };
  const resolver = new NameResolver(client);
  const result: RestoreBatchResult = { total: slice.total, nextOffset: slice.offset + slice.products.length, created: 0, skipped: 0, failed: 0, imagesMissing: 0, differences: [], errors: [], done: false };
  const createdIds: number[] = [];

  const imageCheck = ctx.imageCheck ?? checkImageReachable;

  for (const original of page.products) {
    try {
      const categoryIds: number[] = [];

      for (const path of original.categoryPaths) categoryIds.push(await resolver.categoryId(path));

      const brandName = (original.raw as { brandName?: string | null }).brandName ?? null;
      const resolved = { brandId: await resolver.brandId(brandName), categoryIds };
      // Sample pictures are uploaded after the product exists, so the create body carries none.
      const uploads = slice.loadImage ? ((original.raw as unknown as Partial<PackProductRaw>).images ?? []) : [];
      const { product, missing } = slice.loadImage ? { product: withoutRawImages(original), missing: 0 } : await dropDeadImages(original, imageCheck);
      let id: number;
      let keepUrl = true;
      let keepImages = true;

      // BigCommerce can refuse a product for its URL or an image that looked
      // fine. Each is retried without the offending part, in that order, so a
      // product is never lost to something cosmetic.
      for (;;) {
        try {
          id = await createProduct(client, toCreatePayload(keepImages ? product : withoutImages(product), resolved, { keepUrl }));
          result.imagesMissing += keepImages ? missing : original.imageUrls.length;
          break;
        } catch (error) {
          const detail = error instanceof AppError ? (error.detail ?? "") : "";

          if (keepUrl && error instanceof AppError && /url/i.test(detail) && !/name/i.test(detail)) keepUrl = false;
          else if (keepImages && error instanceof AppError && error.status === 422 && looksLikeImageError(detail)) keepImages = false;
          else throw error;
        }
      }

      const raw = original.raw as unknown as Partial<PackProductRaw>;

      // A modifier or picture BigCommerce refuses must not lose a product that now exists: report it instead.
      try {
        if (raw.modifiers?.length) await createModifiers(client, id, toModifierPayloads(raw.modifiers));
      } catch (error) {
        result.differences.push({ name: original.name, detail: `custom options not created: ${reasonFor(error)}` });
      }

      if (slice.loadImage) {
        let uploaded = 0;
        let whyNot = "";

        for (const image of uploads) {
          try {
            if (!image.file) continue;

            const loaded = await slice.loadImage(image.file);

            await uploadProductImage(client, id, { ...loaded, isThumbnail: image.isThumbnail, sortOrder: image.sortOrder, description: image.description });
            uploaded += 1;
          } catch (error) {
            result.imagesMissing += 1;
            whyNot ||= reasonFor(error);
          }
        }

        if (uploaded < uploads.length) result.differences.push({ name: original.name, detail: `only ${uploaded} of ${uploads.length} images uploaded${whyNot ? ` (${whyNot})` : ""}` });
      } else {
        const difference = await compareRestored(client, id, original, product);

        if (difference) result.differences.push({ name: original.name, detail: difference });
      }

      createdIds.push(id);
      result.created += 1;
    } catch (error) {
      if (error instanceof AppError && error.status === 409) result.skipped += 1;
      else result.failed += 1;

      result.errors.push({ name: original.name, reason: reasonFor(error) });
    }
  }

  result.done = result.nextOffset >= result.total || page.products.length === 0;

  if (createdIds.length) await data.recordDemoProducts(storeHash, createdIds, options.packId);
  void options;

  if (page.products.length) {
    await data.logActivity({
      storeHash,
      userEmail,
      kind: slice.activityKind,
      summary:
        `Restored from ${slice.label}: ${result.created} created, ${result.skipped} skipped, ${result.failed} failed (products ${options.offset + 1}-${result.nextOffset} of ${result.total}).` +
        (result.imagesMissing ? ` ${result.imagesMissing} images no longer existed and were left out.` : "") +
        (result.errors[0] ? ` First problem: ${result.errors[0].name}: ${result.errors[0].reason}` : ""),
      status: result.failed ? (result.created ? "partial" : "failed") : "success",
    });
  }

  return result;
}

// ---- Clear -----------------------------------------------------------------

export interface ClearPreview {
  count: number;
  // Up to five names, so it is clear what would go.
  sample: string[];
}

export async function previewClear(ctx: OpsContext, scope: ClearScope): Promise<ClearPreview> {
  const { client, data, storeHash } = ctx;

  if (scope === "all") {
    const [count, sample] = await Promise.all([countProducts(client), fetchProductNames(client)]);

    return { count, sample: sample.map((product) => product.name) };
  }

  const ids = await data.listDemoProductIds(storeHash);

  if (ids.length === 0) return { count: 0, sample: [] };

  // Some may have been deleted in the control panel since; only count the ones that remain.
  const existing = await fetchProductNames(client, ids, 250);

  return { count: existing.length, sample: existing.slice(0, 5).map((product) => product.name) };
}

export interface ClearStart {
  ids: number[];
}

// Step one of a clear: check the confirmation and say which products would go. The app makes the
// customer download a snapshot of exactly these products before it asks to delete them.
export async function startClear(ctx: OpsContext, options: { scope: ClearScope; confirmation: string }): Promise<ClearStart> {
  const { client, data, storeHash } = ctx;

  if (options.confirmation !== CLEAR_CONFIRMATION) throw new AppError("VALIDATION", `Type ${CLEAR_CONFIRMATION} to confirm.`);

  return { ids: options.scope === "all" ? await fetchAllProductIds(client) : await data.listDemoProductIds(storeHash) };
}

export interface ClearBatchResult {
  deleted: number;
}

export async function clearBatch(ctx: OpsContext, options: { ids: number[]; scope: ClearScope }): Promise<ClearBatchResult> {
  const { client, data, storeHash, userEmail } = ctx;

  if (options.ids.length === 0 || options.ids.length > CLEAR_BATCH_SIZE) throw new AppError("VALIDATION", `Delete between 1 and ${CLEAR_BATCH_SIZE} products at a time.`);

  await deleteProducts(client, options.ids);
  await data.forgetDemoProducts(storeHash, options.ids);
  await data.logActivity({
    storeHash,
    userEmail,
    kind: "catalog.clear",
    summary: `Cleared ${options.ids.length} products (${options.scope === "all" ? "whole catalog" : "demo-created only"}) after downloading a snapshot of them.`,
    status: "success",
  });

  return { deleted: options.ids.length };
}
