// Save, restore and clear: the operations behind the Personal Catalog. Each takes an
// explicit context (client, data store, store hash, user) so Server Actions
// supply the real ones after authorizing, and tests supply fakes.
import { buildPackPreview } from "@/lib/app-data/preview";
import type { AppDataStore, ImagesState, PackProduct, PackSource, PackSummary } from "@/lib/app-data/types";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { countProducts, createModifiers, createProduct, fetchProductSummary, uploadProductImage, deleteProducts, fetchAllProductIds, fetchBrands, fetchCategories, fetchProductNames, fetchProducts } from "@/lib/catalog/catalog-api";
import { blobImageStore } from "@/lib/catalog/image-store";
import { checkImageReachable, collectImageUrls, dropDeadImages, isBlobUrl, type ImageCheck, type ImageStore, looksLikeImageError, rewriteProductImages, withoutImages } from "@/lib/catalog/images";
import { buildCategoryPaths, toCreatePayload, toModifierPayloads, toPackProduct, type PackProductRaw } from "@/lib/catalog/pack-mapper";
import { assertCanUse, assertOwns } from "@/lib/catalog/pack-access";
import { NameResolver } from "@/lib/catalog/resolvers";
import { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION, IMAGE_BATCH_SIZE, MAX_PACK_PRODUCTS, RESTORE_BATCH_SIZE } from "@/lib/catalog/constants";
import { AppError } from "@/lib/errors/app-error";

export { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION, IMAGE_BATCH_SIZE, MAX_PACK_PRODUCTS, RESTORE_BATCH_SIZE };

export interface OpsContext {
  client: BcRestApiClient;
  data: AppDataStore;
  storeHash: string;
  userEmail: string | null;
  // Decides whether a pack image URL still exists. Tests replace it.
  imageCheck?: ImageCheck;
  // Copies images to durable storage. Tests replace it.
  imageStore?: ImageStore;
}

// What the operations that don't touch BigCommerce need.
export type DataContext = Pick<OpsContext, "data" | "storeHash" | "userEmail" | "imageStore">;

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

// ---- Save ------------------------------------------------------------------

export async function savePackFromStore(ctx: OpsContext, options: { name: string; description: string; source?: PackSource; productIds?: number[] }): Promise<PackSummary> {
  const { client, data, storeHash, userEmail } = ctx;
  const products = await fetchProducts(client, options.productIds);

  if (products.length === 0) throw new AppError("VALIDATION", "There are no products to save.");
  if (products.length > MAX_PACK_PRODUCTS) throw new AppError("VALIDATION", `A pack can hold up to ${MAX_PACK_PRODUCTS} products; this store has ${products.length}.`);

  const [categories, brands] = await Promise.all([fetchCategories(client), fetchBrands(client)]);
  const context = {
    categoryPaths: buildCategoryPaths(categories),
    brandNames: new Map(brands.map((brand) => [brand.id, brand.name])),
    // Pick lists name other products; they are saved as SKU/name refs and rebuilt after the import.
    productRefs: new Map(products.map((product) => [product.id, { sku: typeof product.sku === "string" && product.sku ? product.sku : null, name: product.name }])),
  };
  const packProducts = products.map((product) => toPackProduct(product, context));
  // Images get copied in a second, batched step (see preserveImages). Until then
  // the pack is "pending"; with nowhere to copy to, it is "skipped".
  const hasImages = packProducts.some((product) => collectImageUrls(product).length > 0);
  const imagesState: ImagesState = !hasImages ? "preserved" : (ctx.imageStore ?? blobImageStore).configured() ? "pending" : "skipped";
  const pack = await data.savePack({
    name: options.name,
    description: options.description,
    source: options.source ?? "store",
    createdByEmail: userEmail,
    storeHash,
    products: packProducts,
    imagesState,
  });

  await data.logActivity({ storeHash, userEmail, kind: "catalog.save-pack", summary: `Saved ${pack.productCount} products as pack "${pack.name}".`, status: "success" });

  return pack;
}

// ---- Preserve images -------------------------------------------------------

export interface PreserveImagesResult {
  total: number;
  nextOffset: number;
  copied: number;
  // Images that could not be copied (already gone, too large, not an image).
  failed: number;
  done: boolean;
  // Set once the last batch has run.
  state?: ImagesState;
}

const COPY_CONCURRENCY = 5;

async function inGroups<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];

  for (let start = 0; start < items.length; start += size) out.push(...(await Promise.all(items.slice(start, start + size).map(run))));

  return out;
}

// Copies one slice of a pack's images to durable storage and rewrites the pack
// to point at the copies. Safe to repeat: images already copied are skipped, so
// an interrupted run just resumes.
export async function preserveImages(ctx: DataContext, options: { packId: string; offset: number; limit?: number }): Promise<PreserveImagesResult> {
  const { data } = ctx;
  const store = ctx.imageStore ?? blobImageStore;
  const limit = Math.min(options.limit ?? IMAGE_BATCH_SIZE, IMAGE_BATCH_SIZE);
  const page = await data.getPackPage(options.packId, options.offset, limit);

  if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.");

  assertOwns(page.pack, ctx.storeHash);

  if (!store.configured()) throw new AppError("VALIDATION", "Image storage isn't configured. Set BLOB_READ_WRITE_TOKEN on the server.");

  const urls = [...new Set(page.products.flatMap(collectImageUrls))].filter((url) => !isBlobUrl(url));
  const copies = new Map<string, string>();
  let failed = 0;

  await inGroups(urls, COPY_CONCURRENCY, async (url) => {
    const copy = await store.preserve(url);

    if (copy) copies.set(url, copy);
    else failed += 1;
  });

  if (copies.size) await data.updatePackProducts(options.packId, options.offset, page.products.map((product) => rewriteProductImages(product, copies)));

  const result: PreserveImagesResult = { total: page.pack.productCount, nextOffset: options.offset + page.products.length, copied: copies.size, failed, done: false };

  result.done = result.nextOffset >= result.total || page.products.length === 0;

  if (result.done) result.state = await finalizeImages(ctx, options.packId);

  return result;
}

// Looks at the whole pack once copying has finished: marks it preserved if every
// image is a durable copy, partial otherwise, and refreshes the card preview so
// it shows the durable copies.
export async function finalizeImages(ctx: DataContext, packId: string): Promise<ImagesState> {
  const { data, storeHash, userEmail } = ctx;
  const PAGE = 200;
  const light: PackProduct[] = [];
  let remote = 0;
  let durable = 0;
  let name = "";

  for (let offset = 0; ; offset += PAGE) {
    const page = await data.getPackPage(packId, offset, PAGE);

    if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.");

    assertOwns(page.pack, ctx.storeHash);

    name = page.pack.name;

    for (const product of page.products) {
      for (const url of collectImageUrls(product)) (isBlobUrl(url) ? durable++ : remote++);

      light.push({ ...product, raw: {} });
    }

    if (offset + PAGE >= page.pack.productCount || page.products.length === 0) break;
  }

  const state: ImagesState = remote === 0 ? "preserved" : "partial";

  await data.setPackImages(packId, state, buildPackPreview(light));
  await data.logActivity({
    storeHash,
    userEmail,
    kind: "catalog.preserve-images",
    summary: `Copied images for pack "${name}" to durable storage: ${durable} saved${remote ? `, ${remote} could not be copied (already gone)` : ""}.`,
    status: remote ? "partial" : "success",
  });

  return state;
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
  sample: string[];
  // False when images can't be backed up, so a clear would lose them for good.
  canPreserveImages: boolean;
}

export async function previewClear(ctx: OpsContext, scope: ClearScope): Promise<ClearPreview> {
  const { client, data, storeHash } = ctx;
  const canPreserveImages = (ctx.imageStore ?? blobImageStore).configured();

  if (scope === "all") {
    const [count, sample] = await Promise.all([countProducts(client), fetchProductNames(client)]);

    return { count, sample: sample.map((product) => product.name), canPreserveImages };
  }

  const ids = await data.listDemoProductIds(storeHash);

  if (ids.length === 0) return { count: 0, sample: [], canPreserveImages };

  // Some may have been deleted in the control panel since; only count the ones that remain.
  const existing = await fetchProductNames(client, ids, 250);

  return { count: existing.length, sample: existing.slice(0, 5).map((product) => product.name), canPreserveImages };
}

export interface ClearStart {
  backup: { id: string; name: string; productCount: number; imagesState: ImagesState } | null;
  ids: number[];
}

// Step one of a clear: save everything that is about to be deleted as a pack,
// and hand back the ids to delete. Deleting is refused until a backup exists
// (see clearBatch), so this is the only way in.
export async function startClear(ctx: OpsContext, options: { scope: ClearScope; confirmation: string; acceptImageLoss?: boolean }): Promise<ClearStart> {
  const { client, data, storeHash } = ctx;

  if (options.confirmation !== CLEAR_CONFIRMATION) throw new AppError("VALIDATION", `Type ${CLEAR_CONFIRMATION} to confirm.`);

  // Without somewhere to copy images to, the backup can only link to images that
  // BigCommerce deletes along with the products. Make that an explicit choice.
  if (!(ctx.imageStore ?? blobImageStore).configured() && !options.acceptImageLoss) {
    throw new AppError("VALIDATION", "Product images can't be backed up here, so clearing would lose them permanently. Tick the box to accept that, or set BLOB_READ_WRITE_TOKEN.");
  }

  const targetIds = options.scope === "all" ? await fetchAllProductIds(client) : await data.listDemoProductIds(storeHash);

  if (targetIds.length === 0) return { backup: null, ids: [] };

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const backup = await savePackFromStore(ctx, {
    name: `Backup before clear (${options.scope}) · ${storeHash} · ${stamp}`,
    description: "Saved automatically before a bulk clear.",
    source: "backup",
    productIds: targetIds,
  });

  // The backup holds what actually existed, which can be fewer than recorded.
  return { backup: { id: backup.id, name: backup.name, productCount: backup.productCount, imagesState: backup.imagesState }, ids: targetIds };
}

export interface ClearBatchResult {
  deleted: number;
}

export async function clearBatch(ctx: OpsContext, options: { backupPackId: string; ids: number[]; scope: ClearScope }): Promise<ClearBatchResult> {
  const { client, data, storeHash, userEmail } = ctx;

  if (options.ids.length === 0 || options.ids.length > CLEAR_BATCH_SIZE) throw new AppError("VALIDATION", `Delete between 1 and ${CLEAR_BATCH_SIZE} products at a time.`);

  const backup = await data.getPackPage(options.backupPackId, 0, 1);

  if (!backup) throw new AppError("VALIDATION", "Clearing requires a saved backup pack first.");

  assertOwns(backup.pack, storeHash);
  if (backup.pack.imagesState === "pending") throw new AppError("VALIDATION", "The backup's images haven't been copied yet. Finish that first so they aren't lost.");

  await deleteProducts(client, options.ids);
  await data.forgetDemoProducts(storeHash, options.ids);
  await data.logActivity({
    storeHash,
    userEmail,
    kind: "catalog.clear",
    summary: `Cleared ${options.ids.length} products (${options.scope === "all" ? "whole catalog" : "demo-created only"}). Backup: "${backup.pack.name}".`,
    status: "success",
    undo: { packId: options.backupPackId },
  });

  return { deleted: options.ids.length };
}
