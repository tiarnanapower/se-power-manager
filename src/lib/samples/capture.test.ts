import { describe, expect, it } from "vitest";
import type { ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { pickListPayloads } from "@/lib/catalog/pack-mapper";
import { captureCatalogSample } from "@/lib/samples/capture";
import type { SampleCatalogFile, SampleIndex, SampleMeta } from "@/lib/samples/format";

const products = [
  {
    id: 1, name: "Tee", sku: "TEE", price: 10, categories: [10], brand_id: 5, variants: [], custom_fields: [{ name: "Fabric", value: "Cotton" }],
    images: [{ url_zoom: "https://cdn.example/tee.jpg", is_thumbnail: true, sort_order: 0, description: "front" }, { url_zoom: "https://cdn.example/dead.jpg" }],
    modifiers: [{ type: "text", display_name: "Print", required: false, config: {}, option_values: [] }],
  },
  {
    id: 2, name: "Gift Set", sku: "SET", price: 30, categories: [11], variants: [], images: [{ url_zoom: "https://cdn.example/tee.jpg" }], custom_fields: [],
    modifiers: [{ type: "product_list", display_name: "Pick an extra", required: true, config: {}, option_values: [{ id: 9, label: "Tee", sort_order: 0, value_data: { product_id: 1 } }, { id: 10, label: "Ghost", sort_order: 1, value_data: { product_id: 999 } }] }],
  },
];

class FakeClient implements BcRestApiClient {
  private reply<T>(data: unknown): ApiResponse<T> {
    return { data: data as T, headers: new Headers() };
  }

  private page(rows: unknown[]) {
    return { data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } };
  }

  async get<T>(path: string, _options?: ApiRequestOptions) {
    if (path === "/v3/catalog/products") return this.reply<T>(this.page(products));
    if (path === "/v3/catalog/categories") return this.reply<T>(this.page([{ id: 10, parent_id: 0, name: "Clothing" }, { id: 11, parent_id: 10, name: "Sets" }]));
    if (path === "/v3/catalog/brands") return this.reply<T>(this.page([{ id: 5, name: "Acme" }]));

    throw new Error(`unexpected GET ${path}`);
  }

  async post<T>(): Promise<ApiResponse<T>> { throw new Error("read-only"); }
  async put<T>(): Promise<ApiResponse<T>> { throw new Error("read-only"); }
  async delete<T>(): Promise<ApiResponse<T>> { throw new Error("read-only"); }
}

const fetchImage = async (url: string) => (url.includes("dead") ? undefined : { bytes: Buffer.from(`bytes of ${url}`), mime: "image/jpeg" });

describe("captureCatalogSample", () => {
  it("writes a version, its products by chunk, and a shared content-hashed image", async () => {
    const { files, slug, version, warnings, counts } = await captureCatalogSample(new FakeClient(), { name: "Outdoor Retailer", notes: "First capture", readExisting: async () => undefined, fetchImage, now: () => new Date("2026-11-11T09:00:00Z") });

    expect(slug).toBe("outdoor-retailer");
    expect(version).toBe("v1");
    expect(counts).toEqual({ products: 2, categories: 2, images: 1 });
    expect(warnings).toEqual(["Tee: couldn't download https://cdn.example/dead.jpg"]);

    const catalog = JSON.parse(files.get("samples/outdoor-retailer/v1/catalog.json") as string) as SampleCatalogFile;

    expect(catalog.categories.map((category) => category.path)).toEqual(["Clothing", "Clothing > Sets"]);
    expect(catalog.brands).toEqual(["Acme"]);
    expect(catalog.products[0]).toMatchObject({ name: "Tee", customFields: 1, modifiers: 1 });
    expect(catalog.products[0].image).toMatch(/^[a-f0-9]{64}\.jpg$/);
    expect(catalog.products[0].image).toBe(catalog.products[1].image);
    expect([...files.keys()].filter((path) => path.startsWith("images/"))).toHaveLength(1);

    const chunk = JSON.parse(files.get("samples/outdoor-retailer/v1/catalog/products-0001.json") as string) as { raw: { images: { file: string; url: string }[] } }[];

    expect(chunk[0].raw.images[0]).toMatchObject({ file: catalog.products[0].image, url: "" });
  });

  it("replaces pick-list product ids with refs, and the refs rebuild against another store", async () => {
    const { files } = await captureCatalogSample(new FakeClient(), { name: "Pick", readExisting: async () => undefined, fetchImage });
    const chunk = JSON.parse(files.get("samples/pick/v1/catalog/products-0001.json") as string) as { raw: { modifiers: Record<string, unknown>[] } }[];
    const modifier = chunk[1].raw.modifiers[0];
    const values = modifier.option_values as { ref?: { sku: string }; value_data?: unknown }[];

    // The reference to the product that isn't in the catalog is dropped, and no source-store ids remain.
    expect(values).toHaveLength(1);
    expect(values[0].ref).toEqual({ sku: "TEE", name: "Tee" });
    expect(JSON.stringify(modifier)).not.toContain("product_id");

    const { payloads, missing } = pickListPayloads(chunk[1].raw.modifiers, (ref) => (ref.sku === "TEE" ? 4242 : undefined));

    expect(payloads[0].option_values).toEqual([{ label: "Tee", sort_order: 0, value_data: { product_id: 4242 } }]);
    expect(missing).toEqual([]);
    expect(pickListPayloads(chunk[1].raw.modifiers, () => undefined).payloads).toEqual([]);
  });

  it("adds a new version beside the old one and keeps the index sorted", async () => {
    const meta: SampleMeta = { slug: "outdoor", name: "Outdoor", description: "Camping", tags: ["uk"], latest: "v1", defaultLanguage: "en", languages: ["en", "fr"], versions: [{ version: "v1", date: "2026-01-01", notes: "", formatVersion: 1, sections: ["catalog"], products: 1 }] };
    const index: SampleIndex = { format: 1, samples: [{ slug: "zebra", name: "Zebra", description: "", tags: [], latest: "v1", updatedAt: "", products: 1, categories: 0, preview: [], sections: ["catalog"], languages: ["en"] }] };
    const existing: Record<string, string> = { "samples/outdoor/sample.json": JSON.stringify(meta), "catalog.json": JSON.stringify(index) };

    const { files, version } = await captureCatalogSample(new FakeClient(), { name: "Outdoor", slug: "outdoor", notes: "Refreshed prices", readExisting: async (path) => existing[path], fetchImage });
    const updated = JSON.parse(files.get("samples/outdoor/sample.json") as string) as SampleMeta;
    const newIndex = JSON.parse(files.get("catalog.json") as string) as SampleIndex;

    expect(version).toBe("v2");
    expect(updated).toMatchObject({ latest: "v2", description: "Camping", tags: ["uk"], languages: ["en", "fr"] });
    expect(updated.versions.map((entry) => entry.version)).toEqual(["v1", "v2"]);
    expect(newIndex.samples.map((sample) => sample.slug)).toEqual(["outdoor", "zebra"]);
    expect(files.has("samples/outdoor/v1/catalog.json")).toBe(false);
  });
});
