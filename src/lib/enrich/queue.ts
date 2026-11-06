// The Enrich Tool's analysis queue, kept as small JSON documents per store
// (see AppDataStore.putDoc). Queues stay short, so filtering happens here.
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AppDataStore } from '@/lib/app-data/types';
import type { ActionStatus, ActionView, Job, JobView, QueueAction } from './client-types';
import type { ActionPayload } from './types';

export interface QueueScope {
  data: AppDataStore;
  storeHash: string;
}

const JOBS = 'enrich_job';
const ACTIONS = 'enrich_action';
const UPLOADS = 'enrich_upload';

const now = () => new Date().toISOString();

export type NewAction = Pick<QueueAction, 'kind' | 'title' | 'summary' | 'confidence' | 'product_id' | 'variant_id' | 'payload' | 'candidates'>;

export async function createJob(scope: QueueScope, args: { sourceType: 'file' | 'text'; filename: string; mime: string }): Promise<string> {
  const id = randomUUID();
  const job: Job = { id, source_type: args.sourceType, filename: args.filename, mime: args.mime, status: 'analyzing', note: null, created_at: now() };

  await scope.data.putDoc(JOBS, scope.storeHash, id, job);

  return id;
}

export async function finishJob(scope: QueueScope, id: string, status: 'done' | 'error', note?: string): Promise<void> {
  const doc = await scope.data.getDoc(JOBS, scope.storeHash, id);

  if (doc) await scope.data.putDoc(JOBS, scope.storeHash, id, { ...(doc.body as Job), status, note: note ?? null });
}

export async function addActions(scope: QueueScope, jobId: string, rows: NewAction[]): Promise<string[]> {
  const ids: string[] = [];

  for (const row of rows) {
    const id = randomUUID();
    const ts = now();
    const action: QueueAction = { ...row, id, job_id: jobId, status: 'pending', error: null, created_at: ts, updated_at: ts };

    ids.push(id);
    await scope.data.putDoc(ACTIONS, scope.storeHash, id, action);
  }

  return ids;
}

async function allActions(scope: QueueScope): Promise<QueueAction[]> {
  return (await scope.data.listDocs(ACTIONS, scope.storeHash)).map((doc) => doc.body as QueueAction);
}

async function allJobs(scope: QueueScope): Promise<Job[]> {
  return (await scope.data.listDocs(JOBS, scope.storeHash)).map((doc) => doc.body as Job);
}

export async function listQueue(scope: QueueScope, status?: string): Promise<{ actions: ActionView[]; jobs: JobView[]; counts: Record<string, number> }> {
  const [actions, jobs] = await Promise.all([allActions(scope), allJobs(scope)]);
  const byJob = new Map(jobs.map((job) => [job.id, job]));
  const counts: Record<string, number> = {};

  for (const action of actions) counts[action.status] = (counts[action.status] ?? 0) + 1;

  const views = actions
    .filter((action) => !status || status === 'all' || action.status === status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.confidence - a.confidence)
    .map((action): ActionView => {
      const job = byJob.get(action.job_id);

      return { ...action, filename: job?.filename ?? 'Unknown source', source_type: job?.source_type ?? 'file', mime: job?.mime ?? '' };
    });

  // Sources with no reviewable row of their own: still analyzing, or finished without one.
  const withActions = new Set(actions.map((action) => action.job_id));
  const inFlight = jobs
    .filter((job) => job.status === 'analyzing' || !withActions.has(job.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 25)
    .map((job): JobView => ({ id: job.id, filename: job.filename, status: job.status, note: job.note, created_at: job.created_at, actionCount: actions.filter((action) => action.job_id === job.id).length }));

  return { actions: views, jobs: inFlight, counts };
}

/** Poll target for in-flight analyses. */
export async function jobProgress(scope: QueueScope, ids: string[]): Promise<{ jobs: JobView[]; done: boolean; actions: { id: string; kind: QueueAction['kind'] }[] }> {
  const [actions, jobs] = await Promise.all([allActions(scope), allJobs(scope)]);
  const wanted = jobs.filter((job) => ids.includes(job.id));
  const mine = actions.filter((action) => ids.includes(action.job_id)).sort((a, b) => b.confidence - a.confidence || a.created_at.localeCompare(b.created_at));

  return {
    jobs: wanted.map((job) => ({ id: job.id, filename: job.filename, status: job.status, note: job.note, created_at: job.created_at, actionCount: mine.filter((action) => action.job_id === job.id).length })),
    // A job row can lag a moment behind its creation, so treat missing ids as still running.
    done: wanted.length === ids.length && wanted.every((job) => job.status !== 'analyzing'),
    actions: mine.map((action) => ({ id: action.id, kind: action.kind })),
  };
}

export async function getAction(scope: QueueScope, id: string): Promise<QueueAction | undefined> {
  return (await scope.data.getDoc(ACTIONS, scope.storeHash, id))?.body as QueueAction | undefined;
}

export async function updateAction(scope: QueueScope, id: string, patch: Partial<Omit<QueueAction, 'id' | 'job_id' | 'created_at'>>): Promise<QueueAction | undefined> {
  const action = await getAction(scope, id);

  if (!action) return undefined;

  const next = { ...action, ...patch, updated_at: now() };

  await scope.data.putDoc(ACTIONS, scope.storeHash, id, next);

  return next;
}

export async function setStatus(scope: QueueScope, ids: string[], status: ActionStatus): Promise<void> {
  if (status === 'cancelled') await releaseUploads(scope, ids);

  for (const id of ids) await updateAction(scope, id, { status });
}

export async function clearQueue(scope: QueueScope): Promise<void> {
  await scope.data.deleteDocs(UPLOADS, scope.storeHash);
  await scope.data.deleteDocs(ACTIONS, scope.storeHash);
  await scope.data.deleteDocs(JOBS, scope.storeHash);
}

export async function markApplied(scope: QueueScope, id: string, message: string): Promise<void> {
  await updateAction(scope, id, { status: 'applied', error: null, summary: message });
  await releaseUploads(scope, [id]);
}

export async function markFailed(scope: QueueScope, id: string, error: string): Promise<void> {
  await updateAction(scope, id, { status: 'failed', error });
}

// ---- Uploaded packshots, kept only until their action is resolved -----------

export async function putUpload(scope: QueueScope, key: string, body: Buffer, mime: string): Promise<void> {
  await scope.data.putDoc(UPLOADS, scope.storeHash, key, { mime, data: body.toString('base64') });
}

export async function getUpload(scope: QueueScope, key: string): Promise<{ buffer: Buffer; mime: string }> {
  const doc = await scope.data.getDoc(UPLOADS, scope.storeHash, key);

  if (!doc) throw new Error(`Could not read upload ${key}.`);

  const { mime, data } = doc.body as { mime: string; data: string };

  return { buffer: Buffer.from(data, 'base64'), mime };
}

export async function deleteUpload(scope: QueueScope, key: string): Promise<void> {
  await scope.data.deleteDocs(UPLOADS, scope.storeHash, [key]).catch(() => undefined);
}

const imageKey = (payload: ActionPayload) => payload.image?.path ?? null;

/** Drop the uploads belonging to these actions, once they're resolved. */
export async function releaseUploads(scope: QueueScope, ids: string[]): Promise<void> {
  for (const id of ids) {
    const action = await getAction(scope, id);
    const key = action ? imageKey(action.payload) : null;

    if (key) await deleteUpload(scope, key);
  }
}

/**
 * Delete stored files that no action refers to any more (the residue of a crash). Files newer
 * than `graceMs` are left alone: another analysis may have just uploaded one and not yet queued
 * its action, and deleting it then would break that action.
 */
export async function sweepOrphanedUploads(scope: QueueScope, graceMs = 15 * 60_000): Promise<void> {
  const [stored, actions] = await Promise.all([scope.data.listDocs(UPLOADS, scope.storeHash), allActions(scope)]);
  const referenced = new Set(actions.map((action) => imageKey(action.payload)).filter((key): key is string => key !== null));
  const cutoff = Date.now() - graceMs;
  const orphans = stored.filter((doc) => !referenced.has(doc.id) && new Date(doc.createdAt).getTime() <= cutoff).map((doc) => doc.id);

  if (orphans.length) await scope.data.deleteDocs(UPLOADS, scope.storeHash, orphans);
}
