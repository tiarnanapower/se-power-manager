// Helpers shared by the section capture and import code. Not server-only: the capture script uses them.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

export type JsonRecord = Record<string, unknown>;

export interface SectionFile<T = unknown> {
  // What was captured. Absent when the store doesn't have the feature (for example the API answered 404).
  data: T;
  warnings: string[];
}

// What importing a section did, for the results list.
export interface SectionResult {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export const emptyResult = (): SectionResult => ({ created: 0, updated: 0, skipped: 0, warnings: [] });

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export const records = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.flatMap((entry) => (asRecord(entry) ? [asRecord(entry) as JsonRecord] : [])) : []);

export const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const key = (value: unknown): string => text(value).toLowerCase();

export function positiveInt(value: unknown): number | undefined {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function pick(source: JsonRecord, keys: readonly string[]): JsonRecord {
  const out: JsonRecord = {};

  for (const field of keys) if (source[field] !== undefined) out[field] = source[field];

  return out;
}

// A BigCommerce error as one readable line: the request failed with its own explanation when it has one.
export function describe(error: unknown): string {
  const detail = (error as { detail?: string })?.detail;

  return detail || (error instanceof Error ? error.message : "unknown error");
}

// Reads a v3 list endpoint across its pages, or a v2 endpoint that answers with a bare array.
export async function readAll(client: BcRestApiClient, path: string, params: Record<string, string | number> = {}): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const { data } = await client.get<unknown>(path, { params: { ...params, limit: 250, page } });

    if (Array.isArray(data)) {
      rows.push(...records(data));

      // v2 answers 50 at a time with no paging metadata.
      if (data.length < 250) break;

      continue;
    }

    const body = asRecord(data);

    rows.push(...records(body?.data));

    const totalPages = Number(asRecord(asRecord(body?.meta)?.pagination)?.total_pages ?? 1);

    if (page >= totalPages) break;
  }

  return rows;
}

// Runs one capture, turning a refusal (missing scope, feature not on this store) into a warning.
export async function attempt<T>(label: string, warnings: string[], work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    warnings.push(`${label}: ${describe(error)}`);

    return fallback;
  }
}
