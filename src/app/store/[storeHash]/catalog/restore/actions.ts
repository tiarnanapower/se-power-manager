"use server";

import { z } from "zod";
import { type Outcome, runLocalAction, runStoreAction } from "@/lib/actions/run-action";
import { CLEAR_BATCH_SIZE } from "@/lib/catalog/constants";
import {
  clearBatch,
  type ClearBatchResult,
  type ClearPreview,
  type ClearStart,
  preserveImages,
  type PreserveImagesResult,
  previewClear,
  restoreBatch,
  type RestoreBatchResult,
  savePackFromStore,
  startClear,
} from "@/lib/catalog/operations";
import { assertOwns } from "@/lib/catalog/pack-access";
import { AppError } from "@/lib/errors/app-error";
import type { PackSummary } from "@/lib/app-data/types";

const packId = z.string().min(1).max(64);
const scope = z.enum(["all", "demo"]);

export async function savePackAction(storeHash: unknown, input: unknown): Promise<Outcome<{ pack: PackSummary }>> {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Give the pack a name (up to 120 characters)." };

  return runStoreAction(storeHash, "savePackAction", async (ctx) => ({ pack: await savePackFromStore(ctx, parsed.data) }));
}

// Copies one slice of a pack's images to durable storage. The UI calls it
// repeatedly with the returned `nextOffset` until `done`. Needs no BigCommerce
// access, only the pack and the image store.
export async function preserveImagesAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: PreserveImagesResult }>> {
  const parsed = z.object({ packId, offset: z.number().int().min(0) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "preserveImagesAction", async (ctx) => ({ batch: await preserveImages(ctx, parsed.data) }));
}

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
  const parsed = z.object({ scope, confirmation: z.string().max(20), acceptImageLoss: z.boolean().optional() }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "startClearAction", async (ctx) => ({ start: await startClear(ctx, parsed.data) }));
}

export async function clearBatchAction(storeHash: unknown, input: unknown): Promise<Outcome<{ batch: ClearBatchResult }>> {
  const parsed = z.object({ backupPackId: packId, scope, ids: z.array(z.number().int().positive()).min(1).max(CLEAR_BATCH_SIZE) }).safeParse(input);

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
