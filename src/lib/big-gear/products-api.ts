import "server-only";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getBigGearRestClient } from "@/lib/big-gear/config";

export interface BigGearProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  is_visible: boolean;
  primary_image?: { url_thumbnail?: string; url_standard?: string } | null;
}

export interface BigGearProductPage {
  items: BigGearProduct[];
  total: number;
}

// Read-only. Needs "Products: read-only" on the Big Gear token.
export async function listBigGearProducts(options: { page?: number; limit?: number } = {}): Promise<BigGearProductPage> {
  const { page = 1, limit = 10 } = options;
  const { data } = await getBigGearRestClient().get<V3ListResponse<BigGearProduct>>("/v3/catalog/products", {
    params: { page, limit, include: "primary_image" },
  });

  return { items: data.data, total: data.meta.pagination.total };
}
