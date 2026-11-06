// Server-only: the Customer Segmentation API (an Enterprise feature). Needs the
// Customers scope; creating segments and adding customers needs "modify".
import "server-only";
import { type SegmentSummary, type SegmentsResult } from "@/lib/audiences/segment-types";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CACHE_PROFILE_NONE } from "@/lib/cache/cache-profiles";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const SEGMENTS_PATH = "/v3/segments";
const PROFILES_PATH = "/v3/shopper-profiles";
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const MAX_COUNTS = 25;

interface RawSegment {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
}

const toSummary = (segment: RawSegment): SegmentSummary => ({
  id: segment.id,
  name: segment.name,
  description: segment.description ?? "",
  createdAt: segment.created_at ?? null,
  memberCount: null,
});

function explain(error: unknown): string {
  const status = error instanceof AppError ? error.status : undefined;

  if (status === 401 || status === 403) return "The app's token doesn't have the Customers scope needed for segments. Reinstall after adding it.";
  if (status === 404 || status === 405) return "Customer segmentation isn't enabled on this store. It's an Enterprise feature; ask your BigCommerce contact to turn it on.";

  return "BigCommerce didn't return the store's segments.";
}

// Never throws: stores without the feature or scope just have no segments here.
export async function fetchSegments(storeHash: string | undefined): Promise<SegmentsResult> {
  try {
    const apiClient = await getRestApiClient(storeHash);
    const items: SegmentSummary[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await apiClient.get<V3ListResponse<RawSegment>>(SEGMENTS_PATH, {
        params: { page, limit: PAGE_SIZE },
        cache: { profile: CACHE_PROFILE_NONE },
      });
      const batch = data?.data ?? [];

      items.push(...batch.map(toSummary));

      if (batch.length === 0 || page >= (data?.meta?.pagination?.total_pages ?? 1)) break;
    }

    return { available: true, items };
  } catch (error) {
    logError("fetchSegments", error);

    return { available: false, message: explain(error) };
  }
}

// Member counts: one small call per segment, so capped. Needs Customers: modify.
export async function fetchMemberCounts(storeHash: string | undefined, segments: SegmentSummary[]): Promise<SegmentSummary[]> {
  const apiClient = await getRestApiClient(storeHash);
  const counted = segments.slice(0, MAX_COUNTS);
  const results = await Promise.allSettled(
    counted.map((segment) =>
      apiClient.get<V3ListResponse<unknown>>(`${SEGMENTS_PATH}/${encodeURIComponent(segment.id)}/shopper-profiles`, {
        params: { limit: 1 },
        cache: { profile: CACHE_PROFILE_NONE },
      }),
    ),
  );

  return segments.map((segment) => {
    const index = counted.indexOf(segment);
    const result = index >= 0 ? results[index] : undefined;

    return result?.status === "fulfilled" ? { ...segment, memberCount: result.value.data?.meta?.pagination?.total ?? null } : segment;
  });
}

export async function createSegment(storeHash: string | undefined, input: { name: string; description: string }): Promise<SegmentSummary> {
  const apiClient = await getRestApiClient(storeHash);

  try {
    const { data } = await apiClient.post<{ data: RawSegment[] }>(SEGMENTS_PATH, { body: [{ name: input.name, description: input.description }] });
    const created = data?.data?.[0];

    if (!created?.id) throw new AppError("UPSTREAM_API", "BigCommerce didn't return the new segment.");

    return { ...toSummary(created), memberCount: 0 };
  } catch (error) {
    if (error instanceof AppError && error.status === 409) throw new AppError("UPSTREAM_API", "A segment with that name already exists.", { status: 409 });
    if (error instanceof AppError && (error.status === 401 || error.status === 403)) throw new AppError("UPSTREAM_API", "The app needs the Customers: modify scope to create segments.", { status: error.status });

    throw error;
  }
}

export interface AddCustomersResult {
  added: number;
  notFound: string[];
  alreadyMembers: number;
}

interface CustomerRecord {
  id: number;
  email: string;
  shopper_profile_id?: string | null;
  segment_ids?: string[];
}

// Adds registered customers (by email) to a segment: finds the customers,
// creates shopper profiles for any that lack one, then adds the profiles in
// batches of 50 (the API's limit).
export async function addCustomersToSegment(storeHash: string | undefined, segmentId: string, emails: string[]): Promise<AddCustomersResult> {
  const apiClient = await getRestApiClient(storeHash);
  const { data: found } = await apiClient.get<V3ListResponse<CustomerRecord>>("/v3/customers", {
    params: { "email:in": emails.join(","), include: "shopper_profile_id,segment_ids", limit: PAGE_SIZE },
    cache: { profile: CACHE_PROFILE_NONE },
  });
  const customers = found?.data ?? [];
  const known = new Set(customers.map((customer) => customer.email.toLowerCase()));
  const notFound = emails.filter((email) => !known.has(email.toLowerCase()));
  const alreadyMembers = customers.filter((customer) => customer.segment_ids?.includes(segmentId)).length;
  const toAdd = customers.filter((customer) => !customer.segment_ids?.includes(segmentId));
  const profileIds: string[] = toAdd.map((customer) => customer.shopper_profile_id).filter((id): id is string => Boolean(id));
  const needProfile = toAdd.filter((customer) => !customer.shopper_profile_id);

  if (needProfile.length > 0) {
    const { data: created } = await apiClient.post<{ data: Array<{ id: string }> }>(PROFILES_PATH, { body: needProfile.map((customer) => ({ customer_id: customer.id })) });

    profileIds.push(...(created?.data ?? []).map((profile) => profile.id));
  }

  let added = 0;

  for (let start = 0; start < profileIds.length; start += PAGE_SIZE) {
    const batch = profileIds.slice(start, start + PAGE_SIZE);
    const { data } = await apiClient.post<{ data?: unknown[]; meta?: { success?: number } }>(`${SEGMENTS_PATH}/${encodeURIComponent(segmentId)}/shopper-profiles`, { body: batch });

    added += data?.meta?.success ?? data?.data?.length ?? batch.length;
  }

  return { added, notFound, alreadyMembers };
}
