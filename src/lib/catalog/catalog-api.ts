// BigCommerce catalog calls, written against the BcRestApiClient interface so
// the operations built on them can be tested with a fake client.
import type { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import type { BcBrand, BcCategory, BcProduct } from "@/lib/catalog/types";

// Field selection on v3 list endpoints is `include_fields`; a plain `fields` is
// rejected with a 422.
export const PAGE_SIZE = 250;
export const DELETE_CHUNK = 250;
const PRODUCT_INCLUDES = "variants,images,custom_fields,bulk_pricing_rules,videos,modifiers";

async function listAll<T>(client: BcRestApiClient, path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const { data } = await client.get<V3ListResponse<T>>(path, { params: { ...params, limit: PAGE_SIZE, page } });

    items.push(...data.data);

    if (page >= data.meta.pagination.total_pages) return items;
  }
}

// Full product records. With `ids`, only those that still exist come back.
export async function fetchProducts(client: BcRestApiClient, ids?: number[]): Promise<BcProduct[]> {
  if (!ids) return listAll<BcProduct>(client, "/v3/catalog/products", { include: PRODUCT_INCLUDES });

  const products: BcProduct[] = [];

  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    products.push(...(await listAll<BcProduct>(client, "/v3/catalog/products", { include: PRODUCT_INCLUDES, "id:in": ids.slice(start, start + PAGE_SIZE).join(",") })));
  }

  return products;
}

export async function fetchProductNames(client: BcRestApiClient, ids?: number[], limit = 5): Promise<{ id: number; name: string }[]> {
  const { data } = await client.get<V3ListResponse<{ id: number; name: string }>>("/v3/catalog/products", {
    params: { limit, include_fields: "id,name", ...(ids ? { "id:in": ids.slice(0, limit).join(",") } : {}) },
  });

  return data.data;
}

// Just enough of every product to find it again by SKU or name (pick lists point at other products).
export async function fetchProductRefs(client: BcRestApiClient): Promise<{ id: number; name: string; sku: string | null }[]> {
  return (await listAll<{ id: number; name: string; sku?: string }>(client, "/v3/catalog/products", { include_fields: "id,name,sku" })).map((product) => ({ id: product.id, name: product.name, sku: product.sku || null }));
}

export async function fetchAllProductIds(client: BcRestApiClient): Promise<number[]> {
  return (await listAll<{ id: number }>(client, "/v3/catalog/products", { include_fields: "id" })).map((product) => product.id);
}

export async function countProducts(client: BcRestApiClient): Promise<number> {
  const { data } = await client.get<V3ListResponse<{ id: number }>>("/v3/catalog/products", { params: { limit: 1, include_fields: "id" } });

  return data.meta.pagination.total;
}

export async function createProduct(client: BcRestApiClient, body: Record<string, unknown>): Promise<number> {
  const { data } = await client.post<{ data: { id: number } }>("/v3/catalog/products", { body });

  return data.data.id;
}

// Chunked to BigCommerce's 250-id limit. Deleting an id that no longer exists
// is not an error, so a retry after a partial failure is safe.
export async function deleteProducts(client: BcRestApiClient, ids: number[]): Promise<void> {
  for (let start = 0; start < ids.length; start += DELETE_CHUNK) {
    await client.delete(`/v3/catalog/products?id:in=${ids.slice(start, start + DELETE_CHUNK).join(",")}`);
  }
}

export const fetchCategories = (client: BcRestApiClient) => listAll<BcCategory>(client, "/v3/catalog/categories");
export const fetchBrands = (client: BcRestApiClient) => listAll<BcBrand>(client, "/v3/catalog/brands");

export async function createCategory(client: BcRestApiClient, name: string, parentId: number): Promise<number> {
  const { data } = await client.post<{ data: { id: number } }>("/v3/catalog/categories", { body: { name, parent_id: parentId } });

  return data.data.id;
}

export async function createBrand(client: BcRestApiClient, name: string): Promise<number> {
  const { data } = await client.post<{ data: { id: number } }>("/v3/catalog/brands", { body: { name } });

  return data.data.id;
}

export async function createModifiers(client: BcRestApiClient, productId: number, modifiers: Record<string, unknown>[]): Promise<void> {
  for (const body of modifiers) await client.post(`/v3/catalog/products/${productId}/modifiers`, { body });
}

// What actually landed on a restored product, to compare with the pack.
export async function fetchProductSummary(client: BcRestApiClient, id: number): Promise<{ images: number; variants: number; customFields: number }> {
  const { data } = await client.get<{ data: BcProduct }>(`/v3/catalog/products/${id}`, { params: { include: "variants,images,custom_fields" } });
  const product = data.data;

  return {
    images: product.images?.length ?? 0,
    variants: (product.variants ?? []).filter((variant) => (variant.option_values?.length ?? 0) > 0).length,
    customFields: product.custom_fields?.length ?? 0,
  };
}

// Uploads image bytes to a product, for sample products whose pictures live in the samples repo
// (so BigCommerce never needs to reach a URL).
export async function uploadProductImage(
  client: BcRestApiClient,
  productId: number,
  image: { bytes: Buffer; mime: string; filename: string; isThumbnail: boolean; sortOrder: number; description: string },
): Promise<void> {
  const form = new FormData();

  form.append("image_file", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), image.filename);
  form.append("is_thumbnail", String(image.isThumbnail));
  form.append("sort_order", String(image.sortOrder));

  if (image.description) form.append("description", image.description.slice(0, 500));

  await client.post(`/v3/catalog/products/${productId}/images`, { body: form });
}
