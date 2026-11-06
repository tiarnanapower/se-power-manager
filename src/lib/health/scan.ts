// Reads the catalog from the SE's store and evaluates it.
import "server-only";
import type { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { evaluateHealth, type HealthProduct, type HealthReport } from "@/lib/health/checks";

export const MAX_SCANNED_PRODUCTS = 5000;
const PAGE = 250;
const FIELDS = "id,name,sku,type,price,description,is_visible,brand_id,categories,inventory_level,inventory_tracking,page_title,meta_description";

async function fetchProducts(client: BcRestApiClient): Promise<{ products: HealthProduct[]; total: number }> {
  const products: HealthProduct[] = [];
  let total = 0;

  for (let page = 1; products.length < MAX_SCANNED_PRODUCTS; page += 1) {
    const { data } = await client.get<V3ListResponse<HealthProduct>>("/v3/catalog/products", { params: { limit: PAGE, page, include_fields: FIELDS, include: "primary_image" } });

    total = data.meta.pagination.total;
    products.push(...data.data);

    if (page >= data.meta.pagination.total_pages) break;
  }

  return { products: products.slice(0, MAX_SCANNED_PRODUCTS), total };
}

// Product ids that sit on at least one channel. Undefined if the store won't say,
// so the channel check is skipped rather than flagging everything.
async function fetchChannelAssigned(client: BcRestApiClient): Promise<Set<number> | undefined> {
  try {
    const ids = new Set<number>();

    for (let page = 1; page <= 100; page += 1) {
      const { data } = await client.get<V3ListResponse<{ product_id: number }>>("/v3/catalog/products/channel-assignments", { params: { limit: PAGE, page } });

      for (const assignment of data.data) ids.add(assignment.product_id);

      if (page >= data.meta.pagination.total_pages) break;
    }

    return ids;
  } catch {
    return undefined;
  }
}

export interface ScanResult extends HealthReport {
  // Products in the store; `total` is how many were scanned (capped).
  storeTotal: number;
  truncated: boolean;
  scannedAt: string;
}

export async function scanStoreHealth(client: BcRestApiClient): Promise<ScanResult> {
  const [{ products, total }, channelAssigned] = await Promise.all([fetchProducts(client), fetchChannelAssigned(client)]);
  // With no assignments at all (a store that doesn't use channels), the check would flag every product.
  const report = evaluateHealth(products, channelAssigned && channelAssigned.size > 0 ? channelAssigned : undefined);

  return { ...report, storeTotal: total, truncated: total > products.length, scannedAt: new Date().toISOString() };
}
