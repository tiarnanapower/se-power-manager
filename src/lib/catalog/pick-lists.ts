// Pick lists (modifiers of type product_list) point at other products, so they can only be created
// after every product in the import exists. This is the second pass: for each product that has
// one, find it and the products it lists by SKU (else name), and create the modifier.
import type { PackProduct } from "@/lib/app-data/types";
import type { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { createModifiers } from "@/lib/catalog/catalog-api";
import { isPickList, pickListPayloads, type PackProductRaw, type ProductRef } from "@/lib/catalog/pack-mapper";

export interface PickListResult {
  // Products that got their pick lists.
  done: number;
  warnings: { name: string; detail: string }[];
}

export const hasPickList = (product: PackProduct): boolean => ((product.raw as unknown as Partial<PackProductRaw>).modifiers ?? []).some(isPickList);

const refKey = (ref: ProductRef) => (ref.sku ? `sku:${ref.sku.toLowerCase()}` : `name:${ref.name.toLowerCase()}`);

// Looks products up in the destination store, remembering what it finds.
class ProductFinder {
  private found = new Map<string, number>();

  constructor(private readonly client: BcRestApiClient) {}

  async prime(refs: ProductRef[]): Promise<void> {
    const skus = [...new Set(refs.filter((ref) => ref.sku && !this.found.has(refKey(ref))).map((ref) => ref.sku as string))];

    for (let start = 0; start < skus.length; start += 50) {
      const { data } = await this.client.get<V3ListResponse<{ id: number; sku: string }>>("/v3/catalog/products", { params: { "sku:in": skus.slice(start, start + 50).join(","), include_fields: "id,sku", limit: 250 } });

      for (const product of data.data) this.found.set(`sku:${product.sku.toLowerCase()}`, product.id);
    }

    for (const ref of refs.filter((entry) => !entry.sku && !this.found.has(refKey(entry)))) {
      const { data } = await this.client.get<V3ListResponse<{ id: number; name: string }>>("/v3/catalog/products", { params: { name: ref.name, include_fields: "id,name", limit: 1 } });

      if (data.data[0]) this.found.set(refKey(ref), data.data[0].id);
    }
  }

  find(ref: ProductRef): number | undefined {
    return this.found.get(refKey(ref));
  }
}

export async function finishPickLists(client: BcRestApiClient, products: PackProduct[]): Promise<PickListResult> {
  const result: PickListResult = { done: 0, warnings: [] };
  const withLists = products.filter(hasPickList);

  if (withLists.length === 0) return result;

  const finder = new ProductFinder(client);
  const own = withLists.map((product): ProductRef => ({ sku: product.sku, name: product.name }));
  const targets = withLists.flatMap((product) => ((product.raw as unknown as Partial<PackProductRaw>).modifiers ?? []).filter(isPickList).flatMap((modifier) => ((modifier.option_values as { ref?: ProductRef }[] | undefined) ?? []).flatMap((value) => (value.ref ? [value.ref] : []))));

  await finder.prime([...own, ...targets]);

  for (const product of withLists) {
    const id = finder.find({ sku: product.sku, name: product.name });

    if (id === undefined) {
      result.warnings.push({ name: product.name, detail: "pick list not created: the product wasn't found in your store" });
      continue;
    }

    try {
      const existing = await client.get<V3ListResponse<{ display_name: string }>>(`/v3/catalog/products/${id}/modifiers`, { params: { limit: 250 } });
      const have = new Set(existing.data.data.map((modifier) => modifier.display_name.toLowerCase()));
      const { payloads, missing } = pickListPayloads(((product.raw as unknown as Partial<PackProductRaw>).modifiers ?? []), (ref) => finder.find(ref));
      const fresh = payloads.filter((payload) => !have.has(String(payload.display_name).toLowerCase()));

      if (fresh.length) await createModifiers(client, id, fresh);
      if (missing.length) result.warnings.push({ name: product.name, detail: `pick list is missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""} (not in the import)` });

      result.done += 1;
    } catch (error) {
      result.warnings.push({ name: product.name, detail: `pick list not created: ${error instanceof Error ? error.message : "unknown error"}` });
    }
  }

  return result;
}
