// Entry points the Enrich Tool's server actions call: queue sources for
// analysis, edit and apply queued actions.
import 'server-only';
import { after } from 'next/server';
import { AppError } from '@/lib/errors/app-error';
import { applyAction, type ApplyContext } from './apply';
import { analyzeTextSource, analyzeUpload, type AnalyzeContext } from './analyze';
import type { QueueAction } from './client-types';
import { searchProducts } from './bc';
import { createJob, getAction, markApplied, markFailed, releaseUploads, sweepOrphanedUploads, updateAction } from './queue';
import type { ActionPayload } from './types';

export type SourceFile = { name: string; type: string; bytes: Buffer };
export type QueuedJob = { id: string; filename: string };

/**
 * Record a job per source and run the analysis in `after()`, once the response is sent, so the
 * request stays short however long a large PDF takes. Sources run one after another so a
 * multi-file drop doesn't fan out concurrent model and catalog calls.
 */
export async function queueSources(ctx: AnalyzeContext, { files = [], text }: { files?: SourceFile[]; text?: string }): Promise<QueuedJob[]> {
  const jobs: QueuedJob[] = [];
  const tasks: (() => Promise<void>)[] = [];

  for (const file of files) {
    const mime = file.type || 'application/octet-stream';
    const id = await createJob(ctx, { sourceType: 'file', filename: file.name, mime });

    jobs.push({ id, filename: file.name });
    tasks.push(() => analyzeUpload(ctx, id, file.bytes, file.name, mime));
  }

  if (text?.trim()) {
    const id = await createJob(ctx, { sourceType: 'text', filename: 'Pasted text', mime: 'text/plain' });

    jobs.push({ id, filename: 'Pasted text' });
    tasks.push(() => analyzeTextSource(ctx, id, text, 'Pasted text'));
  }

  if (tasks.length > 0) {
    after(async () => {
      for (const task of tasks) await task();

      await sweepOrphanedUploads(ctx);
    });
  }

  return jobs;
}

export type ActionEdit = {
  product_id?: number | null;
  variant_id?: number | null;
  kind?: QueueAction['kind'];
  status?: QueueAction['status'];
  fields?: ActionPayload['fields'];
  variants?: ActionPayload['variants'];
};

/** Save reviewer edits: chosen match, edited field values, or a status change. */
export async function editAction(ctx: ApplyContext, id: string, edit: ActionEdit): Promise<QueueAction> {
  const action = await getAction(ctx, id);

  if (!action) throw new AppError('NOT_FOUND', 'That action no longer exists.');

  const payload: ActionPayload = { ...action.payload, ...(edit.fields ? { fields: edit.fields } : {}), ...(edit.variants ? { variants: edit.variants } : {}) };
  const updated = await updateAction(ctx, id, {
    product_id: edit.product_id !== undefined ? edit.product_id : action.product_id,
    variant_id: edit.variant_id !== undefined ? edit.variant_id : action.variant_id,
    kind: edit.kind ?? action.kind,
    status: edit.status ?? action.status,
    payload,
  });

  if (edit.status === 'cancelled') await releaseUploads(ctx, [id]);

  return updated as QueueAction;
}

/** Push a queued action to BigCommerce. Failures are recorded on the action and returned. */
export async function applyQueued(ctx: ApplyContext, id: string): Promise<{ productId: number; message: string; url: string }> {
  const action = await getAction(ctx, id);

  if (!action) throw new AppError('NOT_FOUND', 'That action no longer exists.');
  if (action.status === 'applied') throw new AppError('VALIDATION', 'Already applied.', { detail: 'This action was already applied.' });

  try {
    const result = await applyAction(ctx, action);

    await markApplied(ctx, id, result.message);

    return result;
  } catch (error) {
    const message = error instanceof AppError ? (error.detail ?? error.message) : error instanceof Error ? error.message : 'Apply failed.';

    await markFailed(ctx, id, message);

    throw new AppError('UPSTREAM_API', message, { detail: message });
  }
}

/** Manual product lookup for the "pick a different product" search in the review modal. */
export async function lookupProducts(ctx: ApplyContext, q: string) {
  if (q.trim().length < 2) return [];

  const products = await searchProducts(ctx.client, [q.trim()], 20);

  return products.slice(0, 20).map((p) => ({
    product_id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    image: p.images?.[0]?.url_thumbnail ?? null,
    variants: (p.variants ?? []).map((v) => ({ id: v.id, label: v.option_values.map((o) => o.label).join(' / ') || v.sku })),
  }));
}
