// BigCommerce catalog calls for the Enrich Tool, over the app's per-store REST
// client (so they use the SE's own store and permissions).
import type { BcRestApiClient } from '@/lib/bc-api-client/rest-client/types';

export type BCImage = {
  id: number;
  product_id: number;
  url_standard: string;
  url_zoom: string;
  url_thumbnail: string;
  is_thumbnail: boolean;
  sort_order: number;
  description: string;
};

export type BCVariant = {
  id: number;
  product_id: number;
  sku: string;
  price: number | null;
  image_url: string;
  option_values: { id: number; label: string; option_id: number; option_display_name: string }[];
};

export type BCProduct = {
  id: number;
  name: string;
  sku: string;
  type: string;
  description: string;
  price: number;
  weight: number;
  brand_id?: number;
  categories?: number[];
  custom_url?: { url: string };
  images?: BCImage[];
  variants?: BCVariant[];
  custom_fields?: { id?: number; name: string; value: string }[];
};

type Query = Record<string, string | number | boolean | undefined>;

/** Calls a v3 endpoint and unwraps its `{ data }` envelope. */
export async function bc<T>(
  client: BcRestApiClient,
  path: string,
  { query, method = 'GET', body }: { query?: Query; method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<T> {
  const response =
    method === 'GET'
      ? await client.get<{ data?: T } & T>(path, { params: query })
      : method === 'POST'
        ? await client.post<{ data?: T } & T>(path, { body })
        : await client.put<{ data?: T } & T>(path, { body });

  const json = response.data;

  return (json && typeof json === 'object' && 'data' in json ? (json as { data: T }).data : json) as T;
}

export async function getProduct(client: BcRestApiClient, id: number, include = 'images,variants,custom_fields') {
  return bc<BCProduct>(client, `/v3/catalog/products/${id}`, { query: { include } });
}

/** Count of products in the store, for the header. */
export async function countCatalog(client: BcRestApiClient): Promise<number> {
  const { data } = await client.get<{ meta: { pagination: { total: number } } }>('/v3/catalog/products', { params: { limit: 1, include_fields: 'id' } });

  return data.meta.pagination.total;
}

/**
 * Keyword search across the store's products. BigCommerce `keyword` covers name/sku/description,
 * so we issue one request per distinct term and merge, rather than relying on a single long query
 * string that would match nothing.
 */
export async function searchProducts(client: BcRestApiClient, terms: string[], limit = 25): Promise<BCProduct[]> {
  const seen = new Map<number, BCProduct>();
  const queries = terms.map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 6);

  for (const keyword of queries) {
    let data: BCProduct[] = [];
    try {
      data = await bc<BCProduct[]>(client, '/v3/catalog/products', { query: { keyword, limit, include: 'images,variants' } });
    } catch {
      continue;
    }
    for (const p of data) if (!seen.has(p.id)) seen.set(p.id, p);
  }
  return [...seen.values()];
}

export async function findBySku(client: BcRestApiClient, sku: string): Promise<BCProduct | null> {
  const data = await bc<BCProduct[]>(client, '/v3/catalog/products', { query: { 'sku:in': sku, limit: 5, include: 'images,variants' } });
  return data[0] ?? null;
}

export async function findVariantBySku(client: BcRestApiClient, sku: string): Promise<BCVariant | null> {
  const data = await bc<BCVariant[]>(client, '/v3/catalog/variants', { query: { sku, limit: 5 } });
  return data[0] ?? null;
}
