"use server";

import { z } from "zod";
import { type Outcome, runStoreAction } from "@/lib/actions/run-action";
import type { ActionStatus, ActionView, JobView, StoreInfo } from "@/lib/enrich/client-types";
import { countCatalog } from "@/lib/enrich/bc";
import { clearQueue, getAction, jobProgress, listQueue, setStatus } from "@/lib/enrich/queue";
import { applyQueued, editAction, lookupProducts, queueSources, type QueuedJob } from "@/lib/enrich/service";
import { isAiConfigured } from "@/lib/ai/portkey";
import { AppError } from "@/lib/errors/app-error";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const id = z.string().min(1).max(64);
const status = z.enum(["pending", "approved", "applied", "cancelled", "failed"]);

// Analysis needs the AI gateway; say so up front instead of failing per source.
function requireAi(): void {
  if (!isAiConfigured()) throw new AppError("VALIDATION", "AI isn't configured.", { detail: "The AI gateway isn't configured. Add PORTKEY_API_KEY to the server environment." });
}

export async function analyzeFilesAction(storeHash: unknown, form: unknown): Promise<Outcome<{ jobs: QueuedJob[] }>> {
  if (!(form instanceof FormData)) return { ok: false, message: "No files received." };

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) return { ok: false, message: "No files received." };
  if (files.length > MAX_FILES) return { ok: false, message: `Add up to ${MAX_FILES} files at a time.` };

  const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);

  if (tooBig) return { ok: false, message: `${tooBig.name} is over 12 MB.` };

  // The body isn't readable once the response has been sent, so read it now.
  const sources = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })));

  return runStoreAction(storeHash, "analyzeFilesAction", async (ctx) => {
    requireAi();

    return { jobs: await queueSources(ctx, { files: sources }) };
  });
}

export async function analyzeTextAction(storeHash: unknown, input: unknown): Promise<Outcome<{ jobs: QueuedJob[] }>> {
  const parsed = z.object({ text: z.string().trim().min(1).max(200_000) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Paste some product information first." };

  return runStoreAction(storeHash, "analyzeTextAction", async (ctx) => {
    requireAi();

    return { jobs: await queueSources(ctx, { text: parsed.data.text }) };
  });
}

export async function getQueueAction(storeHash: unknown, input: unknown): Promise<Outcome<{ actions: ActionView[]; jobs: JobView[]; counts: Record<string, number> }>> {
  const parsed = z.object({ status: z.string().max(20).optional() }).safeParse(input ?? {});

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "getQueueAction", (ctx) => listQueue(ctx, parsed.data.status));
}

export async function getJobsAction(storeHash: unknown, input: unknown) {
  const parsed = z.object({ ids: z.array(id).max(50) }).safeParse(input);

  if (!parsed.success) return { ok: false as const, message: "Invalid request." };

  return runStoreAction(storeHash, "getJobsAction", (ctx) => jobProgress(ctx, parsed.data.ids));
}

export async function getActionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ action: ActionView }>> {
  const parsed = z.object({ id }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "getActionAction", async (ctx) => {
    const { actions } = await listQueue(ctx, "all");
    const action = actions.find((candidate) => candidate.id === parsed.data.id);

    if (!action) throw new AppError("NOT_FOUND", "That action no longer exists.", { detail: "That action no longer exists." });

    return { action };
  });
}

const fieldSchema = z.object({ name: z.string().max(200), label: z.string().max(200), value: z.string().max(20_000), custom: z.boolean(), evidence: z.string().max(2000), disabled: z.boolean().optional() });
const variantSchema = z.object({
  sku: z.string().max(255).nullable(),
  price: z.number().nullable(),
  retailPrice: z.number().nullable(),
  options: z.array(z.object({ name: z.string().max(100), value: z.string().max(200) })).max(10),
  evidence: z.string().max(2000),
  disabled: z.boolean().optional(),
});

export async function editActionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ action: ActionView }>> {
  const parsed = z
    .object({
      id,
      edit: z.object({
        product_id: z.number().int().positive().nullable().optional(),
        variant_id: z.number().int().positive().nullable().optional(),
        kind: z.enum(["create_product", "update_product", "add_product_image", "set_variant_image"]).optional(),
        status: status.optional(),
        fields: z.array(fieldSchema).max(200).optional(),
        variants: z.array(variantSchema).max(200).optional(),
      }),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "editActionAction", async (ctx) => {
    await editAction(ctx, parsed.data.id, parsed.data.edit);

    const { actions } = await listQueue(ctx, "all");
    const action = actions.find((candidate) => candidate.id === parsed.data.id);

    if (!action) throw new AppError("NOT_FOUND", "That action no longer exists.", { detail: "That action no longer exists." });

    return { action };
  });
}

export async function applyActionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ productId: number; message: string; url: string }>> {
  const parsed = z.object({ id }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "applyActionAction", (ctx) => applyQueued(ctx, parsed.data.id));
}

export async function setStatusAction(storeHash: unknown, input: unknown): Promise<Outcome<{ updated: number }>> {
  const parsed = z.object({ ids: z.array(id).min(1).max(500), status: z.enum(["cancelled", "pending"]) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "No actions selected." };

  return runStoreAction(storeHash, "setStatusAction", async (ctx) => {
    await setStatus(ctx, parsed.data.ids, parsed.data.status as ActionStatus);

    return { updated: parsed.data.ids.length };
  });
}

export async function deleteActionAction(storeHash: unknown, input: unknown): Promise<Outcome<{ deleted: true }>> {
  const parsed = z.object({ id }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "deleteActionAction", async (ctx) => {
    if (await getAction(ctx, parsed.data.id)) await setStatus(ctx, [parsed.data.id], "cancelled");

    return { deleted: true as const };
  });
}

export async function clearQueueAction(storeHash: unknown): Promise<Outcome<{ cleared: true }>> {
  return runStoreAction(storeHash, "clearQueueAction", async (ctx) => {
    await clearQueue(ctx);

    return { cleared: true as const };
  });
}

export async function searchProductsAction(storeHash: unknown, input: unknown) {
  const parsed = z.object({ q: z.string().max(200) }).safeParse(input);

  if (!parsed.success) return { ok: false as const, message: "Invalid request." };

  return runStoreAction(storeHash, "searchProductsAction", async (ctx) => ({ products: await lookupProducts(ctx, parsed.data.q) }));
}

export async function getStoreInfoAction(storeHash: unknown): Promise<Outcome<{ info: StoreInfo }>> {
  return runStoreAction(storeHash, "getStoreInfoAction", async (ctx) => {
    const model = process.env.PORTKEY_MODEL ?? "@dev-openai/gpt-5-mini";

    try {
      const [{ data: store }, productCount] = await Promise.all([ctx.client.get<{ name?: string }>("/v2/store"), countCatalog(ctx.client)]);

      return { info: { connected: true, storeName: store.name, storeHash: ctx.storeHash, productCount, model } };
    } catch {
      return { info: { connected: false, storeHash: ctx.storeHash, model, error: "Could not reach BigCommerce." } };
    }
  });
}
