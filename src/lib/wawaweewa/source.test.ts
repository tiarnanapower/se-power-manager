import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { planSource, previewSource, readSourceProducts } from "@/lib/wawaweewa/source";

type Row = Record<string, unknown>;

const v3 = (rows: Row[]) => ({ data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } });

// A read-only fake store: answers from a table of paths and refuses every write.
class Source implements BcRestApiClient {
  calls: string[] = [];

  constructor(private readonly routes: Record<string, unknown | Error>) {}

  async get<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    this.calls.push(`GET ${path} ${JSON.stringify(options.params ?? {})}`);

    const route = this.routes[path];

    if (route === undefined) throw new Error(`GET ${path} not scripted`);
    if (route instanceof Error) throw route;

    return { data: route as T, headers: new Headers() };
  }

  async post<T>(_path: string, _options?: ApiMutationOptions): Promise<ApiResponse<T>> {
    throw new Error("the source store must never be written to");
  }

  async put<T>(_path: string, _options?: ApiMutationOptions): Promise<ApiResponse<T>> {
    throw new Error("the source store must never be written to");
  }

  async delete<T>(_path: string, _options?: ApiMutationOptions): Promise<ApiResponse<T>> {
    throw new Error("the source store must never be written to");
  }
}

describe("Wawaweewa source", () => {
  const products = [
    { id: 1, name: "Tent", sku: "TENT", price: 99, brand_id: 5, categories: [10], images: [{ url_zoom: "https://cdn/a.jpg", is_thumbnail: true, sort_order: 0 }], variants: [], modifiers: [{ id: 3, type: "product_list", display_name: "Add-on", option_values: [{ label: "x", value_data: { product_id: 2 } }] }] },
    { id: 2, name: "Pegs", sku: "PEGS", price: 5, categories: [], variants: [] },
  ];

  it("plans every product with the references pick lists need", async () => {
    const plan = await planSource(new Source({ "/v3/catalog/products": v3([{ id: 1, name: "Tent", sku: "TENT" }, { id: 2, name: "Pegs" }]) }));

    expect(plan.ids).toEqual([1, 2]);
    expect(plan.refs).toEqual([[1, { sku: "TENT", name: "Tent" }], [2, { sku: null, name: "Pegs" }]]);
  });

  it("reads products as store-agnostic ones, with category paths, brand names and pick list references", async () => {
    const source = new Source({
      "/v3/catalog/products": v3(products),
      "/v3/catalog/categories": v3([{ id: 10, parent_id: 0, name: "Camping" }]),
      "/v3/catalog/brands": v3([{ id: 5, name: "Acme" }]),
    });
    const [tent] = await readSourceProducts(source, [1], [[2, { sku: "PEGS", name: "Pegs" }]]);

    expect(tent.categoryPaths).toEqual(["Camping"]);
    expect((tent.raw as { brandName: string }).brandName).toBe("Acme");
    expect(JSON.stringify(tent.raw)).toContain('"sku":"PEGS"');
    expect(JSON.stringify(tent)).not.toContain('"brand_id"');
  });

  it("previews the counts and a short look at both parts", async () => {
    const preview = await previewSource(
      new Source({ "/v3/catalog/products": { ...v3([{ name: "Tent", sku: "TENT", price: 99, primary_image: { url_thumbnail: "https://cdn/t.jpg" } }]), meta: { pagination: { total: 40, count: 1, per_page: 12, current_page: 1, total_pages: 4 } } } }),
      new Source({ "/companies": { data: [{ companyName: "Acme" }, { companyName: "Globex" }], meta: { pagination: { totalCount: 9 } } } }),
    );

    expect(preview).toMatchObject({ productTotal: 40, companyTotal: 9, companies: ["Acme", "Globex"], problems: [] });
    expect(preview.products).toEqual([{ name: "Tent", sku: "TENT", price: 99, image: "https://cdn/t.jpg" }]);
  });

  it("says which part couldn't be read instead of showing zero", async () => {
    const refused = Object.assign(new Error("403"), { status: 403 });
    const preview = await previewSource(new Source({ "/v3/catalog/products": refused }), new Source({ "/companies": refused }));

    expect(preview.problems).toHaveLength(2);
    expect(preview.problems[0]).toContain("catalog");
    expect(preview.problems[0]).toContain("HTTP 403");
    expect(preview.problems[1]).toContain("B2B Edition refused the token (HTTP 403)");
    expect(preview.companyTotal).toBeNull();
  });
});
