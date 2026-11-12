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

// ---- Extras a section may need beyond the store client ------------------------------------------

export interface SectionExtras {
  // A client for the B2B Edition API, which lives on a different host from the store API.
  b2b?: () => Promise<BcRestApiClient>;
  // The language to make the store's default, when the person chose one on import.
  defaultLanguage?: string;
}

// The body of a v3 answer ({ data: {...} }) or of one that is the object itself.
export const unwrap = (body: unknown): JsonRecord | null => asRecord(asRecord(body)?.data) ?? asRecord(body);

// ---- Settings endpoints that are read with GET and written with PUT -----------------------------

export interface SettingSpec {
  id: string;
  label: string;
  path: string;
  // Fields that can't be written (read-only, or tied to the store they came from).
  skip?: readonly string[];
  // Fields to leave as the target store has them (an email address, say), taken from its current settings.
  keep?: readonly string[];
  // Last adjustments to the body before it is written; may add to `warnings`.
  prepare?: (body: JsonRecord, warnings: string[]) => JsonRecord;
}

export async function captureSettings(client: BcRestApiClient, specs: readonly SettingSpec[]): Promise<{ settings: Record<string, JsonRecord>; warnings: string[] }> {
  const warnings: string[] = [];
  const settings: Record<string, JsonRecord> = {};

  for (const spec of specs) {
    const value = await attempt(spec.label, warnings, async () => unwrap((await client.get<unknown>(spec.path)).data), null as JsonRecord | null);

    if (value) settings[spec.id] = value;
  }

  return { settings, warnings };
}

// Writes each captured setting over the target's. Fields that are null are left out, so an unset value
// doesn't wipe the target's.
export async function importSettings(client: BcRestApiClient, specs: readonly SettingSpec[], settings: Record<string, JsonRecord> | undefined): Promise<SectionResult> {
  const result = emptyResult();

  for (const spec of specs) {
    const source = settings?.[spec.id];

    if (!source) continue;

    let body: JsonRecord = {};

    for (const [field, value] of Object.entries(source)) if (value !== null && value !== undefined && !spec.skip?.includes(field)) body[field] = value;

    try {
      if (spec.keep?.length) {
        const current = await attempt(spec.label, result.warnings, async () => unwrap((await client.get<unknown>(spec.path)).data), null as JsonRecord | null);

        for (const field of spec.keep) if (current && current[field] !== undefined && current[field] !== null) body[field] = current[field];
      }

      if (spec.prepare) body = spec.prepare(body, result.warnings);

      await client.put(spec.path, { body });
      result.updated += 1;
    } catch (error) {
      result.warnings.push(`${spec.label}: ${describe(error)}`);
    }
  }

  return result;
}

// ---- GraphQL Admin API --------------------------------------------------------------------------

export async function gql<T = JsonRecord>(client: BcRestApiClient, query: string, variables?: JsonRecord): Promise<T> {
  const { data } = await client.post<unknown>("/graphql", { body: { query, variables } });
  const body = asRecord(data);
  const errors = Array.isArray(body?.errors) ? (body.errors as { message?: string }[]) : [];

  if (errors.length > 0) throw new Error(errors.map((entry) => entry.message ?? "GraphQL error").join("; "));

  return (asRecord(body?.data) ?? {}) as T;
}

// Finds products in a store by SKU, 50 at a time. Returns the first product for each SKU.
export async function productIdsBySku(client: BcRestApiClient, skus: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const unique = [...new Set(skus.filter(Boolean))];

  for (let start = 0; start < unique.length; start += 50) {
    const rows = await readAll(client, "/v3/catalog/products", { "sku:in": unique.slice(start, start + 50).join(","), include_fields: "id,sku" });

    for (const row of rows) {
      const id = positiveInt(row.id);

      if (id && text(row.sku) && !found.has(text(row.sku))) found.set(text(row.sku), id);
    }
  }

  return found;
}
