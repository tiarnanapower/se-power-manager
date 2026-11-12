import { beforeEach, describe, expect, it } from "vitest";
import { memoryAppDataStore } from "@/lib/app-data/memory-store";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { AppError } from "@/lib/errors/app-error";
import { fetchBrands, fetchCategories, fetchProducts } from "@/lib/catalog/catalog-api";
import { CLEAR_CONFIRMATION, clearBatch, previewClear, restoreBatch, startClear, type OpsContext } from "@/lib/catalog/operations";
import { buildCategoryPaths, toCreatePayload, toPackProduct } from "@/lib/catalog/pack-mapper";

type Row = Record<string, unknown> & { id: number };

// A minimal in-memory BigCommerce catalog: enough of the v3 products,
// categories and brands endpoints to run the operations end to end.
class FakeStore implements BcRestApiClient {
  products: Row[] = [];
  categories: Row[] = [];
  brands: Row[] = [];
  private nextId = 1;
  deleteCalls: string[] = [];

  private respond<T>(data: unknown): ApiResponse<T> {
    return { data: data as T, headers: new Headers() };
  }

  private page(rows: Row[], params: ApiRequestOptions["params"] = {}) {
    const limit = Number(params.limit ?? 50);
    const page = Number(params.page ?? 1);
    const ids = params["id:in"] ? String(params["id:in"]).split(",").map(Number) : undefined;
    const filtered = ids ? rows.filter((row) => ids.includes(row.id)) : rows;
    // BigCommerce answers 422 to query parameters it doesn't know; `fields` is one.
    if ("fields" in params) throw new AppError("UPSTREAM_API", "failed", { status: 422 });

    const fields = params.include_fields ? String(params.include_fields).split(",") : undefined;
    const slice = filtered.slice((page - 1) * limit, page * limit).map((row) => (fields ? Object.fromEntries(fields.map((f) => [f, row[f]])) : row));

    return { data: slice, meta: { pagination: { total: filtered.length, count: slice.length, per_page: limit, current_page: page, total_pages: Math.max(1, Math.ceil(filtered.length / limit)) } } };
  }

  async get<T>(path: string, options: ApiRequestOptions = {}) {
    if (path === "/v3/catalog/products") return this.respond<T>(this.page(this.products, options.params));
    if (path === "/v3/catalog/categories") return this.respond<T>(this.page(this.categories, options.params));
    if (path === "/v3/catalog/brands") return this.respond<T>(this.page(this.brands, options.params));

    const single = path.match(/^\/v3\/catalog\/products\/(\d+)$/);

    if (single) {
      const row = this.products.find((product) => product.id === Number(single[1]));

      if (!row) throw new AppError("UPSTREAM_API", "failed", { status: 404 });

      return this.respond<T>({ data: row });
    }

    throw new Error(`unexpected GET ${path}`);
  }

  async post<T>(path: string, options: ApiMutationOptions = {}) {
    const body = options.body as Record<string, unknown>;

    if (path === "/v3/catalog/categories") {
      const row = { id: this.nextId++, name: body.name as string, parent_id: body.parent_id as number };

      this.categories.push(row);

      return this.respond<T>({ data: row });
    }

    if (path === "/v3/catalog/brands") {
      const row = { id: this.nextId++, name: body.name as string };

      this.brands.push(row);

      return this.respond<T>({ data: row });
    }

    if (path === "/v3/catalog/products") {
      if (body.sku && this.products.some((product) => product.sku === body.sku)) throw new AppError("UPSTREAM_API", "failed", { status: 409, detail: "Duplicate sku" });

      const requested = (body.images as { image_url: string }[] | undefined) ?? [];

      // BigCommerce fetches each image while creating the product and refuses the product if one is gone.
      if (requested.some((image) => image.image_url.includes("dead.example"))) throw new AppError("UPSTREAM_API", "failed", { status: 422, detail: "The product image could not be retrieved. images.0.image_url" });

      const images = requested.map((image) => ({ url_zoom: image.image_url }));
      const row: Row = { ...body, id: this.nextId++, images, variants: (body.variants as unknown[]) ?? [] } as Row;

      this.products.push(row);

      return this.respond<T>({ data: { id: row.id } });
    }

    const modifiers = path.match(/^\/v3\/catalog\/products\/(\d+)\/modifiers$/);

    if (modifiers) {
      const row = this.products.find((product) => product.id === Number(modifiers[1]));

      if (!row) throw new AppError("UPSTREAM_API", "failed", { status: 404 });

      row.modifiers = [...((row.modifiers as unknown[]) ?? []), body];

      return this.respond<T>({ data: body });
    }

    throw new Error(`unexpected POST ${path}`);
  }

  async put<T>(): Promise<ApiResponse<T>> {
    throw new Error("unexpected PUT");
  }

  async delete<T>(path: string) {
    this.deleteCalls.push(path);

    const ids = new URL(`https://x${path}`).searchParams.get("id:in")?.split(",").map(Number) ?? [];

    this.products = this.products.filter((product) => !ids.includes(product.id));

    return this.respond<T>(undefined);
  }
}

function seed(store: FakeStore) {
  const outdoor: Row = { id: 100, name: "Outdoor", parent_id: 0 };
  const tents: Row = { id: 101, name: "Tents", parent_id: 100 };

  store.categories.push(outdoor, tents);
  store.brands.push({ id: 200, name: "Acme" });
  store.products.push(
    { id: 1, name: "Tent", sku: "TENT-1", price: 99, type: "physical", weight: 5, brand_id: 200, categories: [101], images: [{ url_zoom: "https://cdn/a.jpg", is_thumbnail: true, sort_order: 0 }], variants: [{ sku: "TENT-1", option_values: [] }] },
    { id: 2, name: "Shirt", sku: "SHIRT", price: 20, type: "physical", weight: 1, categories: [], variants: [{ sku: "SHIRT-S", option_values: [{ option_display_name: "Size", label: "S" }] }, { sku: "SHIRT-M", option_values: [{ option_display_name: "Size", label: "M" }] }] },
    { id: 3, name: "Lamp", sku: "LAMP", price: 10, type: "physical", weight: 2, categories: [], variants: [] },
  );
}

// The default image check treats nothing as dead; tests that need dead images pass their own.
function context(client: FakeStore, storeHash = "src1", imageCheck: OpsContext["imageCheck"] = async () => true): OpsContext {
  return { client, data: memoryAppDataStore, storeHash, userEmail: "se@example.com", imageCheck };
}

// Saves a fake store's products as a pack, the way the Import From External Site tool stages them.
async function savePackFromStore(ctx: OpsContext, options: { name: string; description: string }) {
  const [products, categories, brands] = await Promise.all([fetchProducts(ctx.client), fetchCategories(ctx.client), fetchBrands(ctx.client)]);

  if (products.length === 0) throw new Error("There are no products to save.");

  const mapContext = { categoryPaths: buildCategoryPaths(categories), brandNames: new Map(brands.map((brand) => [brand.id, brand.name])) };

  return ctx.data.savePack({ name: options.name, description: options.description, source: "store", createdByEmail: ctx.userEmail, storeHash: ctx.storeHash, products: products.map((product) => toPackProduct(product, mapContext)) });
}

// Packs are private to the store that saved them, so tests that restore a pack into a
// different store publish it first, as a real user would from the Shared Catalog.
async function savePublished(ctx: OpsContext, options: Parameters<typeof savePackFromStore>[1]) {
  const pack = await savePackFromStore(ctx, options);

  await memoryAppDataStore.publishPack(pack.id, { publishedBy: "test" });

  return pack;
}

beforeEach(() => {
  (globalThis as { __sePowerManagerMemory?: unknown }).__sePowerManagerMemory = undefined;
});

describe("savePackFromStore", () => {
  it("stores products with category paths, brand names and only real variants", async () => {
    const source = new FakeStore();

    seed(source);

    const summary = await savePackFromStore(context(source), { name: "Outdoor demo", description: "" });
    const pack = await memoryAppDataStore.getPack(summary.id);

    expect(summary.productCount).toBe(3);
    expect(pack?.createdByEmail).toBe("se@example.com");
    expect(pack?.products[0].categoryPaths).toEqual(["Outdoor > Tents"]);
    expect((pack?.products[0].raw as { brandName: string }).brandName).toBe("Acme");
    expect((pack?.products[0].raw as { variants: unknown[] }).variants).toHaveLength(0);
    expect((pack?.products[1].raw as { variants: unknown[] }).variants).toHaveLength(2);
    expect(pack?.products[0].imageUrls).toEqual(["https://cdn/a.jpg"]);
  });

  it("refuses an empty selection", async () => {
    await expect(savePackFromStore(context(new FakeStore()), { name: "x", description: "" })).rejects.toThrow("no products");
  });
});

describe("restoreBatch", () => {
  it("recreates products, categories and brands in another store, in batches", async () => {
    const source = new FakeStore();

    seed(source);

    const pack = await savePublished(context(source), { name: "p", description: "" });
    const target = new FakeStore();
    const first = await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 0, limit: 2 });

    expect(first).toMatchObject({ created: 2, nextOffset: 2, done: false, total: 3 });

    const second = await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: first.nextOffset });

    expect(second).toMatchObject({ created: 1, done: true });
    expect(target.products.map((product) => product.name)).toEqual(["Tent", "Shirt", "Lamp"]);
    expect(target.categories.map((category) => category.name)).toEqual(["Outdoor", "Tents"]);
    expect(target.brands.map((brand) => brand.name)).toEqual(["Acme"]);
    expect(target.products[1].variants).toHaveLength(2);
    expect(await memoryAppDataStore.listDemoProductIds("dst1")).toHaveLength(3);
  });

  it("does not create a category or brand twice across batches", async () => {
    const source = new FakeStore();

    seed(source);
    source.products.push({ id: 4, name: "Tent 2", sku: "TENT-2", price: 1, type: "physical", weight: 1, brand_id: 200, categories: [101], variants: [] });

    const pack = await savePublished(context(source), { name: "p", description: "" });
    const target = new FakeStore();

    await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 0, limit: 1 });
    await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 1 });

    expect(target.categories).toHaveLength(2);
    expect(target.brands).toHaveLength(1);
  });

  it("skips a duplicate SKU and keeps going", async () => {
    const source = new FakeStore();

    seed(source);

    const pack = await savePublished(context(source), { name: "p", description: "" });
    const target = new FakeStore();

    target.products.push({ id: 900, name: "Existing", sku: "SHIRT" });

    const result = await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 0 });

    expect(result).toMatchObject({ created: 2, skipped: 1, failed: 0 });
    expect(result.errors[0].name).toBe("Shirt");
  });

  it("errors for a missing pack", async () => {
    await expect(restoreBatch(context(new FakeStore()), { packId: "nope", offset: 0 })).rejects.toThrow("no longer exists");
  });
});

describe("restore with images that no longer exist", () => {
  async function packWithImages(images: Record<string, string[]>) {
    const source = new FakeStore();

    source.products.push(
      ...Object.entries(images).map(([name, urls], index) => ({ id: index + 1, name, sku: name, price: 1, type: "physical", weight: 1, categories: [], variants: [], images: urls.map((url, i) => ({ url_zoom: url, is_thumbnail: i === 0, sort_order: i })) }) as Row),
    );

    return savePublished(context(source), { name: "p", description: "" });
  }

  it("leaves out dead images, keeps live ones, and still creates the product", async () => {
    const pack = await packWithImages({ Tent: ["https://live.example/a.jpg", "https://dead.example/b.jpg"], Lamp: ["https://dead.example/c.jpg"], Plain: [] });
    const target = new FakeStore();
    const result = await restoreBatch(context(target, "dst1", async (url) => !url.includes("dead.example")), { packId: pack.id, offset: 0 });

    expect(result).toMatchObject({ created: 3, failed: 0, imagesMissing: 2 });
    expect(target.products.find((p) => p.name === "Tent")?.images).toEqual([{ url_zoom: "https://live.example/a.jpg" }]);
    expect(target.products.find((p) => p.name === "Lamp")?.images).toEqual([]);
  });

  it("makes the first surviving image the thumbnail when the original thumbnail was dead", async () => {
    const pack = await packWithImages({ Tent: ["https://dead.example/a.jpg", "https://live.example/b.jpg"] });
    const target = new FakeStore();
    const posted: unknown[] = [];
    const original = target.post.bind(target);

    target.post = (async (path: string, options?: ApiMutationOptions) => {
      if (path === "/v3/catalog/products") posted.push(options?.body);

      return original(path, options);
    }) as typeof target.post;

    await restoreBatch(context(target, "dst1", async (url) => !url.includes("dead.example")), { packId: pack.id, offset: 0 });

    expect((posted[0] as { images: { is_thumbnail: boolean }[] }).images).toEqual([expect.objectContaining({ image_url: "https://live.example/b.jpg", is_thumbnail: true })]);
  });

  it("retries without images when BigCommerce still refuses one the check let through", async () => {
    const pack = await packWithImages({ Tent: ["https://dead.example/a.jpg"] });
    const target = new FakeStore();
    const result = await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 0 });

    expect(result).toMatchObject({ created: 1, failed: 0, imagesMissing: 1 });
    expect(target.products[0].images).toEqual([]);
  });

  it("reports the reason when a product fails for another 422", async () => {
    const pack = await packWithImages({ Tent: [] });
    const target = new FakeStore();

    target.post = (async () => {
      throw new AppError("UPSTREAM_API", "failed", { status: 422, detail: "price must be a number" });
    }) as typeof target.post;

    const result = await restoreBatch(context(target, "dst1"), { packId: pack.id, offset: 0 });

    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect(result.errors).toEqual([{ name: "Tent", reason: "price must be a number" }]);
    expect((await memoryAppDataStore.listActivity({ storeHash: "dst1" }))[0].summary).toContain("First problem: Tent: price must be a number");
  });
});

describe("toCreatePayload", () => {
  it("never carries source ids and defaults required fields", () => {
    const payload = toCreatePayload({ name: "X", sku: null, price: null, description: null, imageUrls: [], categoryPaths: [], raw: {} }, { brandId: undefined, categoryIds: [] });

    expect(payload).toEqual({ name: "X", type: "physical", price: 0, weight: 0 });
  });
});

describe("clear", () => {
  it("previews counts for the whole catalog and for demo-created only", async () => {
    const store = new FakeStore();

    seed(store);
    await memoryAppDataStore.recordDemoProducts("src1", [2, 999], null);

    expect(await previewClear(context(store), "all")).toMatchObject({ count: 3 });
    // 999 is recorded but no longer exists in the store, so it isn't counted.
    expect(await previewClear(context(store), "demo")).toEqual({ count: 1, sample: ["Shirt"] });
  });

  it("requires the typed confirmation", async () => {
    const store = new FakeStore();

    seed(store);
    await expect(startClear(context(store), { scope: "all", confirmation: "delete" })).rejects.toThrow("Type DELETE");
    expect(store.products).toHaveLength(3);
  });

  it("says which products to delete, then deletes them in batches", async () => {
    const store = new FakeStore();

    seed(store);

    const started = await startClear(context(store), { scope: "all", confirmation: CLEAR_CONFIRMATION });

    expect(started.ids).toEqual([1, 2, 3]);
    expect(store.products).toHaveLength(3);

    await clearBatch(context(store), { ids: started.ids, scope: "all" });

    expect(store.products).toHaveLength(0);

    const activity = await memoryAppDataStore.listActivity({ storeHash: "src1" });

    expect(activity.some((entry) => entry.kind === "catalog.clear")).toBe(true);
  });

  it("scope demo deletes only products this app created", async () => {
    const store = new FakeStore();

    seed(store);
    await memoryAppDataStore.recordDemoProducts("src1", [3], null);

    const started = await startClear(context(store), { scope: "demo", confirmation: CLEAR_CONFIRMATION });

    expect(started.ids).toEqual([3]);

    await clearBatch(context(store), { ids: started.ids, scope: "demo" });

    expect(store.products.map((product) => product.id)).toEqual([1, 2]);
    expect(await memoryAppDataStore.listDemoProductIds("src1")).toEqual([]);
  });

  it("has nothing to delete when no demo products were recorded", async () => {
    const store = new FakeStore();

    seed(store);

    expect(await startClear(context(store), { scope: "demo", confirmation: CLEAR_CONFIRMATION })).toEqual({ ids: [] });
  });

  it("rejects oversized delete batches", async () => {
    const store = new FakeStore();

    await expect(clearBatch(context(store), { ids: Array.from({ length: 251 }, (_, i) => i), scope: "all" })).rejects.toThrow("between 1 and 250");
  });
});

describe("restore fidelity", () => {
  it("recreates bulk pricing, modifiers, videos, URL and variants without store-specific ids", async () => {
    const source = new FakeStore();

    source.products.push({
      id: 1, name: "Tee", sku: "TEE", price: 10, categories: [], images: [{ url_zoom: "https://ok.example/a.jpg", sort_order: 0, is_thumbnail: true, description: "front" }],
      custom_url: { url: "/tee/", is_customized: true },
      bulk_pricing_rules: [{ id: 9, quantity_min: 5, quantity_max: 0, type: "percent", amount: 10 }],
      videos: [{ id: 3, title: "Demo", type: "youtube", video_id: "abc", sort_order: 1 }],
      modifiers: [{ id: 4, product_id: 1, type: "text", required: true, display_name: "Engraving", config: { text_max_length: 10 }, option_values: [] }],
      variants: [{ id: 7, product_id: 1, sku: "TEE-S", price: 10, cost_price: 4, option_values: [{ id: 55, option_id: 77, option_display_name: "Size", label: "S" }] }],
    } as Row);

    const pack = await savePublished(context(source), { name: "fidelity", description: "" });
    const target = new FakeStore();
    const result = await restoreBatch(context(target, "dst"), { packId: pack.id, offset: 0 });
    const row = target.products[0] as Record<string, unknown>;

    expect(result).toMatchObject({ created: 1, failed: 0, differences: [] });
    expect(row.bulk_pricing_rules).toEqual([{ quantity_min: 5, quantity_max: 0, type: "percent", amount: 10 }]);
    expect(row.videos).toEqual([{ title: "Demo", type: "youtube", video_id: "abc", sort_order: 1 }]);
    expect(row.custom_url).toEqual({ url: "/tee/", is_customized: true });
    expect(row.modifiers).toEqual([{ type: "text", required: true, display_name: "Engraving", config: { text_max_length: 10 }, option_values: [] }]);
    expect(row.variants).toEqual([{ sku: "TEE-S", price: 10, cost_price: 4, option_values: [{ option_display_name: "Size", label: "S" }] }]);
    expect((row.images as { url_zoom: string }[]).map((image) => image.url_zoom)).toHaveLength(1);
  });
});

describe("pack privacy between stores", () => {
  function seededSource() {
    const source = new FakeStore();

    source.products.push({ id: 1, name: "Tee", sku: "TEE", price: 10, type: "physical", weight: 1, categories: [], variants: [], images: [] } as never);

    return source;
  }

  it("keeps a pack private to the store that saved it", async () => {
    const pack = await savePackFromStore(context(seededSource(), "storeA"), { name: "mine", description: "" });

    expect((await memoryAppDataStore.listPacks({ ownedBy: "storeA" })).map((entry) => entry.id)).toEqual([pack.id]);
    expect(await memoryAppDataStore.listPacks({ ownedBy: "storeB" })).toEqual([]);
    await expect(restoreBatch(context(new FakeStore(), "storeB"), { packId: pack.id, offset: 0 })).rejects.toThrow("no longer exists");
  });

  it("lets other stores restore a published pack", async () => {
    const pack = await savePublished(context(seededSource(), "storeA"), { name: "shared", description: "" });
    const other = context(new FakeStore(), "storeB");

    expect(await restoreBatch(other, { packId: pack.id, offset: 0 })).toMatchObject({ created: 1, failed: 0 });
  });
});
