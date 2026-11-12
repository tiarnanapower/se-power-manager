// Reading the source store for Wawaweewa. Everything here takes a client, so it is tested with a fake and
// never needs the environment.
import type { PackProduct } from "@/lib/app-data/types";
import type { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { countProducts, fetchBrands, fetchCategories, fetchProductRefs, fetchProducts } from "@/lib/catalog/catalog-api";
import { buildCategoryPaths, toPackProduct, type ProductRef } from "@/lib/catalog/pack-mapper";
import { b2bProblem } from "@/lib/samples/sections/b2b";
import { asRecord, records, text } from "@/lib/samples/sections/shared";

export interface SourcePlan {
  ids: number[];
  // product id -> how to find that product again in another store, for pick lists
  refs: [number, ProductRef][];
}

export interface SourcePreview {
  products: { name: string; sku: string; price: number | null; image: string | null }[];
  productTotal: number;
  companies: string[];
  companyTotal: number | null;
  // Set when a part couldn't be read, so the page can say so instead of showing zero.
  problems: string[];
}

// Every product in the source, and what pick lists need to find other products again.
export async function planSource(client: BcRestApiClient): Promise<SourcePlan> {
  const all = await fetchProductRefs(client);

  return { ids: all.map((product) => product.id), refs: all.map((product): [number, ProductRef] => [product.id, { sku: product.sku, name: product.name }]) };
}

// A few products of the source as store-agnostic pack products.
export async function readSourceProducts(client: BcRestApiClient, ids: number[], refs: [number, ProductRef][]): Promise<PackProduct[]> {
  const [products, categories, brands] = await Promise.all([fetchProducts(client, ids), fetchCategories(client), fetchBrands(client)]);
  const context = { categoryPaths: buildCategoryPaths(categories), brandNames: new Map(brands.map((brand) => [brand.id, brand.name])), productRefs: new Map(refs) };

  return products.map((product) => toPackProduct(product, context));
}

// What the page shows before anything is imported: counts and a short look at both parts.
export async function previewSource(client: BcRestApiClient, b2b: BcRestApiClient): Promise<SourcePreview> {
  const problems: string[] = [];
  const preview: SourcePreview = { products: [], productTotal: 0, companies: [], companyTotal: null, problems };

  try {
    const [total, page] = await Promise.all([countProducts(client), client.get<V3ListResponse<{ name: string; sku?: string; price?: number; primary_image?: { url_thumbnail?: string } }>>("/v3/catalog/products", { params: { limit: 12, include_fields: "name,sku,price", include: "primary_image" } })]);

    preview.productTotal = total;
    preview.products = page.data.data.map((product) => ({ name: product.name, sku: product.sku ?? "", price: typeof product.price === "number" ? product.price : null, image: product.primary_image?.url_thumbnail ?? null }));
  } catch (error) {
    const status = (error as { status?: number })?.status;

    problems.push(`The source store's catalog couldn't be read${status ? ` (HTTP ${status})` : ""}. Check WAWAWEEWA_STORE_HASH and that WAWAWEEWA_ACCESS_TOKEN has the Products scope.`);
  }

  try {
    const { data } = await b2b.get<unknown>("/companies", { params: { limit: 8, offset: 0 } });
    const body = asRecord(data);

    preview.companies = records(body?.data).map((company) => text(company.companyName)).filter(Boolean);
    preview.companyTotal = Number(asRecord(asRecord(body?.meta)?.pagination)?.totalCount ?? preview.companies.length);
  } catch (error) {
    problems.push(`${b2bProblem(error)} B2B companies can't be imported until this is fixed.`);
  }

  return preview;
}
