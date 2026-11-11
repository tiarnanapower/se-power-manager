import { describe, expect, it } from "vitest";
import { memoryAppDataStore } from "@/lib/app-data/memory-store";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { restoreProducts, type OpsContext } from "@/lib/catalog/operations";
import { finishPickLists } from "@/lib/catalog/pick-lists";
import type { SampleProduct } from "@/lib/samples/format";

// A recording store: remembers what is created and answers the lookups the importer makes.
class RecordingStore implements BcRestApiClient {
  products: { id: number; sku?: string; name: string; body: Record<string, unknown> }[] = [];
  images: { productId: number; form: FormData }[] = [];
  modifiers: { productId: number; body: Record<string, unknown> }[] = [];
  failModifiersFor: number | undefined;
  private next = 100;

  private reply<T>(data: unknown): ApiResponse<T> {
    return { data: data as T, headers: new Headers() };
  }

  private page(rows: unknown[]) {
    return { data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } };
  }

  async get<T>(path: string, options: ApiRequestOptions = {}) {
    const params = options.params ?? {};

    if (path === "/v3/catalog/categories" || path === "/v3/catalog/brands") return this.reply<T>(this.page([]));
    if (path === "/v3/catalog/products") {
      const skus = params["sku:in"] ? String(params["sku:in"]).split(",") : undefined;
      const rows = this.products.filter((product) => (skus ? skus.includes(product.sku ?? "") : params.name ? product.name === params.name : true)).map((product) => ({ id: product.id, sku: product.sku, name: product.name }));

      return this.reply<T>(this.page(rows));
    }

    const modifiers = path.match(/^\/v3\/catalog\/products\/(\d+)\/modifiers$/);

    if (modifiers) return this.reply<T>(this.page(this.modifiers.filter((entry) => entry.productId === Number(modifiers[1])).map((entry) => ({ display_name: entry.body.display_name }))));

    const single = path.match(/^\/v3\/catalog\/products\/(\d+)$/);

    if (single) return this.reply<T>({ data: { id: Number(single[1]), images: [], variants: [], custom_fields: [] } });

    throw new Error(`unexpected GET ${path}`);
  }

  async post<T>(path: string, options: ApiMutationOptions = {}) {
    if (path === "/v3/catalog/products") {
      const body = options.body as Record<string, unknown>;
      const product = { id: this.next++, sku: body.sku as string | undefined, name: body.name as string, body };

      this.products.push(product);

      return this.reply<T>({ data: { id: product.id } });
    }

    const image = path.match(/^\/v3\/catalog\/products\/(\d+)\/images$/);

    if (image) {
      this.images.push({ productId: Number(image[1]), form: options.body as FormData });

      return this.reply<T>({ data: {} });
    }

    const modifier = path.match(/^\/v3\/catalog\/products\/(\d+)\/modifiers$/);

    if (modifier) {
      if (this.failModifiersFor === Number(modifier[1])) throw new Error("modifier refused");

      this.modifiers.push({ productId: Number(modifier[1]), body: options.body as Record<string, unknown> });

      return this.reply<T>({ data: {} });
    }

    throw new Error(`unexpected POST ${path}`);
  }

  async put<T>(): Promise<ApiResponse<T>> { throw new Error("unexpected PUT"); }
  async delete<T>(): Promise<ApiResponse<T>> { throw new Error("unexpected DELETE"); }
}

const sampleProduct = (name: string, sku: string, raw: Record<string, unknown> = {}): SampleProduct => ({
  name, sku, price: 10, description: "x", imageUrls: [], categoryPaths: [],
  raw: { fields: { sku, price: 10, type: "physical" }, variants: [], customFields: [], images: [], bulkPricingRules: [], videos: [], modifiers: [], ...raw },
});

const context = (client: RecordingStore): OpsContext => ({ client, data: memoryAppDataStore, storeHash: "dst", userEmail: null });

describe("importing a sample", () => {
  const files = { a: `${"a".repeat(64)}.jpg`, b: `${"b".repeat(64)}.png` };
  const slice = {
    label: 'sample "Demo" v1', total: 1, offset: 0, packId: null, activityKind: "samples.import",
    loadImage: async (file: string) => ({ bytes: Buffer.from(`bytes ${file}`), mime: file.endsWith("png") ? "image/png" : "image/jpeg", filename: file }),
  };

  it("creates the product without picture links, then uploads each picture from the repo", async () => {
    const store = new RecordingStore();
    const product = sampleProduct("Tee", "TEE", { images: [{ url: "", file: files.a, isThumbnail: true, sortOrder: 0, description: "front" }, { url: "", file: files.b, isThumbnail: false, sortOrder: 1, description: "" }] });
    const result = await restoreProducts(context(store), { ...slice, products: [product] });

    expect(result).toMatchObject({ created: 1, failed: 0, imagesMissing: 0, differences: [] });
    expect(store.products[0].body.images).toBeUndefined();
    expect(store.images).toHaveLength(2);
    expect(store.images[0].form.get("is_thumbnail")).toBe("true");
    expect((store.images[1].form.get("image_file") as File).type).toBe("image/png");
  });

  it("keeps the product and reports a picture that can't be loaded", async () => {
    const store = new RecordingStore();
    const product = sampleProduct("Tee", "TEE", { images: [{ url: "", file: files.a, isThumbnail: true, sortOrder: 0, description: "" }] });
    const result = await restoreProducts(context(store), { ...slice, products: [product], loadImage: async () => { throw new Error("gone"); } });

    expect(result).toMatchObject({ created: 1, failed: 0, imagesMissing: 1 });
    expect(result.differences[0].detail).toContain("0 of 1 images");
  });

  it("keeps a product whose custom options BigCommerce refuses, and says so", async () => {
    const store = new RecordingStore();

    store.failModifiersFor = 100;

    const product = sampleProduct("Mug", "MUG", { modifiers: [{ type: "text", display_name: "Engraving", required: false, config: {}, option_values: [] }] });
    const result = await restoreProducts(context(store), { ...slice, products: [product] });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.differences[0].detail).toContain("custom options not created");
  });

  it("leaves pick lists to the second pass and builds them against the new store's ids", async () => {
    const store = new RecordingStore();
    const pick = { type: "product_list", display_name: "Add an extra", required: true, config: {}, option_values: [{ label: "Tee", sort_order: 0, ref: { sku: "TEE", name: "Tee" } }, { label: "Ghost", sort_order: 1, ref: { sku: "GHOST", name: "Ghost" } }] };
    const products = [sampleProduct("Tee", "TEE"), sampleProduct("Gift Set", "SET", { modifiers: [pick] })];

    await restoreProducts(context(store), { ...slice, total: 2, products });

    // First pass: the pick list isn't created yet, because the products it points at may not exist.
    expect(store.modifiers).toEqual([]);

    const result = await finishPickLists(store, products);
    const created = store.modifiers[0];
    const gift = store.products.find((entry) => entry.sku === "SET");
    const tee = store.products.find((entry) => entry.sku === "TEE");

    expect(result.done).toBe(1);
    expect(created.productId).toBe(gift?.id);
    expect(created.body.option_values).toEqual([{ label: "Tee", sort_order: 0, value_data: { product_id: tee?.id } }]);
    expect(result.warnings[0].detail).toContain("GHOST");

    // Running it again doesn't duplicate the pick list.
    await finishPickLists(store, products);

    expect(store.modifiers).toHaveLength(1);
  });
});
