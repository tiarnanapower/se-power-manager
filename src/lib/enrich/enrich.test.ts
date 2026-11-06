import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { memoryAppDataStore } from "@/lib/app-data/memory-store";
import { applyAction } from "./apply";
import type { QueueAction } from "./client-types";
import { pruneUnchangedFields } from "./match";
import { catalogPrice, priceFields } from "./prices";
import { addActions, createJob, finishJob, getUpload, listQueue, markApplied, putUpload, setStatus, sweepOrphanedUploads } from "./queue";

const scope = () => ({ data: memoryAppDataStore, storeHash: `t${Math.random().toString(36).slice(2, 8)}` });

class Recorder implements BcRestApiClient {
  calls: { method: string; path: string; body?: unknown }[] = [];
  constructor(private readonly responses: Record<string, unknown> = {}) {}

  private reply<T>(method: string, path: string, body?: unknown): ApiResponse<T> {
    this.calls.push({ method, path, body });
    return { data: (this.responses[`${method} ${path}`] ?? { data: method === "GET" ? [] : {} }) as T, headers: new Headers() };
  }

  async get<T>(path: string, _options?: ApiRequestOptions) { return this.reply<T>("GET", path); }
  async post<T>(path: string, options: ApiMutationOptions = {}) { return this.reply<T>("POST", path, options.body); }
  async put<T>(path: string, options: ApiMutationOptions = {}) { return this.reply<T>("PUT", path, options.body); }
  async delete<T>(path: string) { return this.reply<T>("DELETE", path); }
}

const payload = (over: Partial<QueueAction["payload"]> = {}): QueueAction["payload"] => ({
  extracted: { name: "Tee", sku: "TEE-1", brand: null, price: 10, description: "Soft" },
  fields: [{ name: "weight", label: "Weight", value: "0.4", custom: false, evidence: "w" }, { name: "material", label: "Material", value: "Cotton", custom: true, evidence: "m" }],
  notes: [],
  ...over,
});

const action = (kind: QueueAction["kind"], over: Partial<QueueAction> = {}): QueueAction => ({
  id: "a1", job_id: "j1", kind, status: "pending", title: "Tee", summary: "", confidence: 0.9, product_id: null, variant_id: null, payload: payload(), candidates: [], error: null, created_at: "", updated_at: "", ...over,
});

describe("enrich queue", () => {
  it("lists actions per store, newest first, with in-flight jobs and counts", async () => {
    const a = scope();
    const b = scope();
    const job = await createJob(a, { sourceType: "text", filename: "Pasted text", mime: "text/plain" });
    const idle = await createJob(a, { sourceType: "file", filename: "empty.pdf", mime: "application/pdf" });

    await addActions(a, job, [{ kind: "create_product", title: "Tee", summary: "", confidence: 0.5, product_id: null, variant_id: null, payload: payload(), candidates: [] }]);
    await finishJob(a, job, "done", "1 queued");
    await finishJob(a, idle, "error", "No readable text");

    const queue = await listQueue(a, "pending");

    expect(queue.actions).toHaveLength(1);
    expect(queue.actions[0]).toMatchObject({ filename: "Pasted text", status: "pending" });
    expect(queue.counts).toEqual({ pending: 1 });
    expect(queue.jobs.map((entry) => entry.filename)).toEqual(["empty.pdf"]);
    expect((await listQueue(b)).actions).toHaveLength(0);
  });

  it("keeps an uploaded image only until its action is resolved", async () => {
    const s = scope();
    const job = await createJob(s, { sourceType: "file", filename: "p.jpg", mime: "image/jpeg" });
    const [id] = await addActions(s, job, [{ kind: "add_product_image", title: "p", summary: "", confidence: 1, product_id: 1, variant_id: null, payload: payload({ image: { path: "k1", filename: "p.jpg", ocrText: null, caption: null } }), candidates: [] }]);

    await putUpload(s, "k1", Buffer.from("bytes"), "image/jpeg");
    await putUpload(s, "orphan", Buffer.from("x"), "image/jpeg");
    // A fresh upload may belong to an analysis still in flight, so it survives a sweep.
    await sweepOrphanedUploads(s);
    expect((await getUpload(s, "orphan")).buffer.toString()).toBe("x");

    await sweepOrphanedUploads(s, 0);

    expect((await getUpload(s, "k1")).buffer.toString()).toBe("bytes");
    await expect(getUpload(s, "orphan")).rejects.toThrow();

    await setStatus(s, [id], "cancelled");
    await expect(getUpload(s, "k1")).rejects.toThrow();
  });

  it("marks an action applied with its message", async () => {
    const s = scope();
    const job = await createJob(s, { sourceType: "text", filename: "t", mime: "text/plain" });
    const [id] = await addActions(s, job, [{ kind: "create_product", title: "Tee", summary: "", confidence: 1, product_id: null, variant_id: null, payload: payload(), candidates: [] }]);

    await markApplied(s, id, "Created it.");

    expect((await listQueue(s, "applied")).actions[0]).toMatchObject({ status: "applied", summary: "Created it." });
  });
});

describe("applyAction", () => {
  it("creates a product with core fields, custom fields and inline variants", async () => {
    const client = new Recorder({ "POST /v3/catalog/products": { data: { id: 77, name: "Tee" } } });
    const scoped = { ...scope(), client };
    const result = await applyAction(scoped, action("create_product", { payload: payload({ variants: [{ sku: null, price: 12, retailPrice: null, options: [{ name: "Size", value: "S" }], evidence: "e" }] }) }));
    const create = client.calls.find((call) => call.path === "/v3/catalog/products")?.body as Record<string, unknown>;

    expect(result.productId).toBe(77);
    expect(create).toMatchObject({ name: "Tee", type: "physical", price: 10, weight: 0.4, sku: "TEE-1" });
    expect(create.variants).toEqual([{ sku: "TEE-1-S", price: 12, option_values: [{ option_display_name: "Size", label: "S" }] }]);
    expect(client.calls.find((call) => call.path.endsWith("/custom-fields") && call.method === "POST")?.body).toEqual({ name: "Material", value: "Cotton" });
  });

  it("updates only the enabled core fields on an existing product", async () => {
    const client = new Recorder();
    const fields = [{ name: "weight", label: "Weight", value: "2", custom: false, evidence: "" }, { name: "width", label: "Width", value: "9", custom: false, evidence: "", disabled: true }];

    await applyAction({ ...scope(), client }, action("update_product", { product_id: 5, payload: payload({ fields }) }));

    expect(client.calls.find((call) => call.method === "PUT")).toMatchObject({ path: "/v3/catalog/products/5", body: { weight: 2 } });
  });
});

describe("match helpers", () => {
  it("drops proposed fields the product already has", async () => {
    const client = new Recorder({ "GET /v3/catalog/products/9": { data: { id: 9, weight: 2, description: "Soft", custom_fields: [{ name: "Material", value: "cotton" }] } } });
    const kept = await pruneUnchangedFields(client, 9, [
      { name: "weight", value: "2.00", custom: false },
      { name: "description", value: "Brand new", custom: false },
      { name: "Material", value: "Cotton", custom: true },
      { name: "Colour", value: "Red", custom: true },
    ]);

    expect(kept.map((field) => field.name)).toEqual(["description", "Colour"]);
  });

  it("proposes the trade price, and the RRP separately", () => {
    const price = (value: number, label: string) => ({ value, currency: null, label, evidence: label });
    const prices = { cost: price(6, "Trade"), retail: price(10, "RRP"), unlabelled: null };

    expect(catalogPrice(prices)).toBe(6);
    expect(priceFields(prices, { isNew: false }).fields.map((field) => [field.name, field.value])).toEqual([["price", "6"], ["retail_price", "10"]]);
  });
});
