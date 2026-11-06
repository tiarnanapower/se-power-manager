// Server-only: the store's name and time zone, so dates read the way they do
// in the BigCommerce control panel.
import "server-only";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { logError } from "@/lib/errors/logger";
import { isValidTimeZone } from "@/lib/promo-calendar/zone";

export interface StoreInfo {
  name: string | null;
  timeZone: string;
  // e.g. "£"; empty when unknown.
  currencySymbol: string;
  // false when we fell back to UTC (no scope, or an unrecognised zone).
  fromStore: boolean;
}

export const DEFAULT_STORE_INFO: StoreInfo = { name: null, timeZone: "UTC", currencySymbol: "", fromStore: false };

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; info: StoreInfo }>();

interface StoreResponse {
  name?: string;
  timezone?: { name?: string };
  currency_symbol?: string;
}

// Needs the "Information & Settings: read-only" scope. Never throws: a store
// without that scope just shows UTC.
export async function fetchStoreInfo(storeHash: string | undefined): Promise<StoreInfo> {
  const key = storeHash ?? "static";
  const hit = cache.get(key);

  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;

  try {
    const apiClient = await getRestApiClient(storeHash);
    const { data } = await apiClient.get<StoreResponse>("/v2/store");
    const zone = data?.timezone?.name;
    const info: StoreInfo =
      zone && isValidTimeZone(zone) ? { name: data?.name ?? null, timeZone: zone, currencySymbol: data?.currency_symbol ?? "", fromStore: true } : { ...DEFAULT_STORE_INFO, name: data?.name ?? null, currencySymbol: data?.currency_symbol ?? "" };

    cache.set(key, { at: Date.now(), info });

    return info;
  } catch (error) {
    logError("fetchStoreInfo", error);

    return DEFAULT_STORE_INFO;
  }
}
