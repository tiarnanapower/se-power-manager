"use client";

// Import runs live here, not in a component, so leaving the page no longer loses their progress.
// The loops keep running in the browser tab; any page can read the state and show it again.
import { useSyncExternalStore } from "react";

export interface Job {
  id: string;
  title: string;
  /** Where to go to see the job's own page again. */
  href: string;
  phase: "running" | "done";
  stage: string;
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  /** One line of running totals, written by whoever runs the job. */
  summary: string;
  error?: string;
  issues: string[];
  cancelRequested: boolean;
}

let jobs: Record<string, Job> = {};
const listeners = new Set<() => void>();
const NONE: Job[] = [];
let list: Job[] = NONE;

function publish(next: Record<string, Job>) {
  jobs = next;
  list = Object.values(next);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => { listeners.delete(listener); };
};

export function startJob(id: string, info: { title: string; href: string; stage?: string; total?: number }): void {
  publish({ ...jobs, [id]: { id, title: info.title, href: info.href, phase: "running", stage: info.stage ?? "Starting", done: 0, total: info.total ?? 0, startedAt: Date.now(), summary: "", issues: [], cancelRequested: false } });
}

export function patchJob(id: string, patch: Partial<Omit<Job, "id" | "startedAt">>): void {
  const current = jobs[id];

  if (current) publish({ ...jobs, [id]: { ...current, ...patch } });
}

export function finishJob(id: string, patch: Partial<Omit<Job, "id" | "startedAt" | "phase">> = {}): void {
  patchJob(id, { ...patch, phase: "done", finishedAt: Date.now() });
}

export const requestCancel = (id: string) => patchJob(id, { cancelRequested: true });
export const isCancelled = (id: string) => jobs[id]?.cancelRequested === true;
export const isRunning = (id: string) => jobs[id]?.phase === "running";

export function dismissJob(id: string): void {
  const rest = { ...jobs };

  delete rest[id];
  publish(rest);
}

export const useJob = (id: string): Job | undefined => useSyncExternalStore(subscribe, () => jobs[id], () => undefined);
export const useJobs = (): Job[] => useSyncExternalStore(subscribe, () => list, () => NONE);
