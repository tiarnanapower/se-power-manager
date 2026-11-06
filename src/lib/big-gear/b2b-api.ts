// B2B Edition Management API for the Big Gear store. Separate from the REST
// client because it lives on its own host and takes an extra header.
import "server-only";
import { getBigGearConfigOrThrow } from "@/lib/big-gear/config";
import { AppError } from "@/lib/errors/app-error";

const B2B_BASE_URL = "https://api-b2b.bigcommerce.com/api";
const TIMEOUT_MS = 20_000;

export async function b2bGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const { storeHash, b2bToken } = getBigGearConfigOrThrow();
  const url = new URL(`${B2B_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const response = await fetch(url, {
    headers: { "X-Auth-Token": b2bToken, "X-Store-Hash": storeHash, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new AppError("UPSTREAM_API", `The B2B Edition API returned ${response.status}. Check the token has the B2B Edition scope.`, { status: response.status });
  }

  return (await response.json()) as T;
}

interface CompaniesResponse {
  data?: unknown[];
  meta?: { pagination?: { totalCount?: number } };
}

// Cheap reachability check: one company, reading the total from the page meta.
export async function countBigGearCompanies(): Promise<number | undefined> {
  const body = await b2bGet<CompaniesResponse>("/v3/io/companies", { limit: 1, offset: 0 });

  return body.meta?.pagination?.totalCount ?? body.data?.length;
}
