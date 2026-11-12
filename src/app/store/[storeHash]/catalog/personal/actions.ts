"use server";

import { z } from "zod";
import { type Outcome, runLocalAction, runStoreAction } from "@/lib/actions/run-action";
import { CLEAR_BATCH_SIZE } from "@/lib/catalog/constants";
import {
  clearBatch,
  type ClearBatchResult,
  type ClearPreview,
  type ClearStart,
  previewClear,
  restoreBatch,
  type RestoreBatchResult,
  startClear,
} from "@/lib/catalog/operations";
import { collectImageUrls } from "@/lib/catalog/images";
import { assertOwns } from "@/lib/catalog/pack-access";
import { assertPublicUrl } from "@/lib/import/safe-fetch";
import { AppError } from "@/lib/errors/app-error";
import type { PackProduct } from "@/lib/app-data/types";

const packId = z.string().min(1).max(64);
const scope = z.enum(["all", "demo"]);

export async function restoreBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: RestoreBatchResult }>> {
  const parsed = z.object({ packId, offset: z.number().int().min(0) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "restoreBatchAction", async (ctx) => ({ batch: await restoreBatch(ctx, parsed.data) }));
}

export async function previewClearAction(storeHash: unknown, input: unknown): Promise<Outcome<{ preview: ClearPreview }>> {
  const parsed = z.object({ scope }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "previewClearAction", async (ctx) => ({ preview: await previewClear(ctx, parsed.data.scope) }));
}

export async function startClearAction(storeHash: unknown, input: unknown): Promise<Outcome<{ start: ClearStart }>> {
  const parsed = z.object({ scope, confirmation: z.string().max(20) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "startClearAction", async (ctx) => ({ start: await startClear(ctx, parsed.data) }));
}

export async function clearBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: ClearBatchResult }>> {
  const parsed = z.object({ scope, ids: z.array(z.number().int().positive()).min(1).max(CLEAR_BATCH_SIZE) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "clearBatchAction", async (ctx) => ({ batch: await clearBatch(ctx, parsed.data) }));
}

// Only the store that saved a pack can delete it, and within it only the person who
// saved it (or anyone, for packs with no recorded person).
export async function deletePackAction(storeHash: unknown, input: unknown): Promise<Outcome<{ deleted: true }>> {
  const parsed = z.object({ packId }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "deletePackAction", async (ctx) => {
    const page = await ctx.data.getPackPage(parsed.data.packId, 0, 1);

    if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.");

    assertOwns(page.pack, ctx.storeHash);

    if (page.pack.createdByEmail && page.pack.createdByEmail !== ctx.userEmail) throw new AppError("AUTH", `Only ${page.pack.createdByEmail} can delete this pack.`);

    await ctx.data.deletePack(parsed.data.packId);
    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "catalog.delete-pack", summary: `Deleted pack "${page.pack.name}".`, status: "success" });

    return { deleted: true as const };
  });
}

// One product of this store's own pack, for the popup on the pack's page.
export async function getPackProductAction(storeHash: unknown, input: unknown): Promise<Outcome<{ product: PackProduct }>> {
  const parsed = z.object({ packId, index: z.number().int().min(0).max(100_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "getPackProductAction", async (ctx) => {
    const page = await ctx.data.getPackPage(parsed.data.packId, parsed.data.index, 1);

    if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.", { detail: "That pack no longer exists." });

    assertOwns(page.pack, ctx.storeHash);

    if (!page.products[0]) throw new AppError("NOT_FOUND", "That product isn't in the pack.", { detail: "That product isn't in the pack." });

    return { product: page.products[0] };
  });
}

// ---- Export for the sample repo ----------------------------------------------------------------
// The export is put together in the browser (images are hashed and zipped there) so no single
// response is large. These actions only hand over the pieces, each limited to this store's own pack.

const EXPORT_PAGE_SIZE = 25;
const EXPORT_IMAGE_LIMIT = 3 * 1024 * 1024;

export async function getPackExportPageAction(storeHash: unknown, input: unknown): Promise<Outcome<{ products: PackProduct[]; total: number }>> {
  const parsed = z.object({ packId, offset: z.number().int().min(0).max(100_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "getPackExportPageAction", async (ctx) => {
    const page = await ctx.data.getPackPage(parsed.data.packId, parsed.data.offset, EXPORT_PAGE_SIZE);

    if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.", { detail: "That pack no longer exists." });

    assertOwns(page.pack, ctx.storeHash);

    return { products: page.products, total: page.pack.productCount };
  });
}

// One picture of the pack, as base64. Only addresses the pack itself lists can be fetched.
export async function getPackImageAction(storeHash: unknown, input: unknown): Promise<Outcome<{ image: { base64: string; mime: string } | null }>> {
  const parsed = z.object({ packId, offset: z.number().int().min(0).max(100_000), url: z.string().url().max(2000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "getPackImageAction", async (ctx) => {
    const page = await ctx.data.getPackPage(parsed.data.packId, parsed.data.offset, EXPORT_PAGE_SIZE);

    if (!page) throw new AppError("NOT_FOUND", "That pack no longer exists.", { detail: "That pack no longer exists." });

    assertOwns(page.pack, ctx.storeHash);

    if (!page.products.some((product) => collectImageUrls(product).includes(parsed.data.url))) throw new AppError("VALIDATION", "That picture isn't in the pack.", { detail: "That picture isn't in the pack." });

    try {
      const url = await assertPublicUrl(parsed.data.url);
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

      if (!response.ok || !mime.startsWith("image/")) return { image: null };

      const bytes = Buffer.from(await response.arrayBuffer());

      return bytes.length > 0 && bytes.length <= EXPORT_IMAGE_LIMIT ? { image: { base64: bytes.toString("base64"), mime } } : { image: null };
    } catch {
      return { image: null };
    }
  });
}
