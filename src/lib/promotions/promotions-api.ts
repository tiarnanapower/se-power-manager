// Server-only: uses the store API token (see CLAUDE.md working rules).
import "server-only";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CACHE_PROFILE_NONE } from "@/lib/cache/cache-profiles";
import {
  getPromotionPath,
  Promotion,
  PROMOTIONS_PATH,
  READ_ONLY_PROMOTION_FIELDS,
  RedemptionType,
} from "@/lib/promotions/types";

// Promotions are never cached: a calendar that shows a stale schedule is worse
// than one extra request. Pagination is bounded so one render can't burn the
// store's rate limit (50 per page, at most 20 pages per redemption type).
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

async function fetchAllOfType(redemptionType: RedemptionType, storeHash: string | undefined): Promise<Promotion[]> {
  const apiClient = await getRestApiClient(storeHash);
  const all: Promotion[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await apiClient.get<V3ListResponse<Promotion>>(PROMOTIONS_PATH, {
      params: { redemption_type: redemptionType, sort: "id", direction: "desc", page, limit: PAGE_SIZE },
      cache: { profile: CACHE_PROFILE_NONE },
    });
    const items = data?.data ?? [];

    all.push(...items);

    if (items.length === 0 || page >= (data?.meta?.pagination?.total_pages ?? 1)) break;
  }

  return all;
}

// Every promotion on the store (automatic and coupon, any status).
export async function fetchAllPromotions(storeHash: string | undefined): Promise<Promotion[]> {
  const [automatic, coupon] = await Promise.all([
    fetchAllOfType("AUTOMATIC", storeHash),
    fetchAllOfType("COUPON", storeHash),
  ]);

  return [...automatic, ...coupon];
}

export async function fetchPromotion(id: number | string, storeHash: string | undefined): Promise<Promotion> {
  const apiClient = await getRestApiClient(storeHash);
  const { data } = await apiClient.get<{ data: Promotion }>(getPromotionPath(id), {
    cache: { profile: CACHE_PROFILE_NONE },
  });

  return data.data;
}

// Strips BigCommerce-owned fields before a write. redemption_type can't be
// changed after creation, so it is dropped from updates only.
export function toWritablePromotion(promotion: Promotion, forUpdate: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { ...promotion };

  for (const field of READ_ONLY_PROMOTION_FIELDS) delete body[field];
  if (forUpdate) delete body.redemption_type;

  return body;
}

export async function createPromotion(promotion: Promotion, storeHash: string | undefined): Promise<Promotion> {
  const apiClient = await getRestApiClient(storeHash);
  const { data } = await apiClient.post<{ data: Promotion }>(PROMOTIONS_PATH, {
    body: toWritablePromotion(promotion, false),
  });

  return data.data;
}

export async function updatePromotion(
  id: number | string,
  promotion: Promotion,
  storeHash: string | undefined,
): Promise<Promotion> {
  const apiClient = await getRestApiClient(storeHash);
  const { data } = await apiClient.put<{ data: Promotion }>(getPromotionPath(id), {
    body: toWritablePromotion(promotion, true),
  });

  return data.data;
}

// A cheap read used by Settings → Test connection: how many promotions the
// store has, without downloading them.
export async function countPromotions(storeHash: string | undefined): Promise<number> {
  const apiClient = await getRestApiClient(storeHash);
  const { data } = await apiClient.get<V3ListResponse<Promotion>>(PROMOTIONS_PATH, {
    params: { limit: 1 },
    cache: { profile: CACHE_PROFILE_NONE },
  });

  return data?.meta?.pagination?.total ?? data?.data?.length ?? 0;
}

export interface CouponCodeInput {
  code: string;
  max_uses?: number;
}

export async function createCouponCode(id: number | string, code: CouponCodeInput, storeHash: string | undefined): Promise<void> {
  const apiClient = await getRestApiClient(storeHash);

  await apiClient.post(`${getPromotionPath(id)}/codes`, { body: code });
}
