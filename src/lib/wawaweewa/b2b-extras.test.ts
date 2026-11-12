import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { importCustomRoles, importOrders, importQuotes, listSourceOrders, listSourceQuotes, readCustomRoles, readSourceQuotes } from "@/lib/wawaweewa/b2b-extras";

type Handler = unknown | ((options: ApiRequestOptions & ApiMutationOptions) => unknown);

// A fake store: answers from a table of "METHOD path" and records every write.
class Fake implements BcRestApiClient {
  writes: { method: string; path: string; body: unknown }[] = [];

  constructor(private readonly routes: Record<string, Handler> = {}) {}

  private answer<T>(method: string, path: string, options: ApiRequestOptions & ApiMutationOptions = {}): ApiResponse<T> {
    const route = this.routes[`${method} ${path}`];

    if (route === undefined) {
      if (method === "GET") return { data: { data: [], meta: { pagination: { totalCount: 0 } } } as T, headers: new Headers() };

      throw new Error(`${method} ${path} not scripted`);
    }

    const value = typeof route === "function" ? (route as (o: unknown) => unknown)(options) : route;

    if (value instanceof Error) throw value;
    if (method !== "GET") this.writes.push({ method, path, body: options.body });

    return { data: value as T, headers: new Headers() };
  }

  async get<T>(path: string, options?: ApiRequestOptions) { return this.answer<T>("GET", path, options); }
  async post<T>(path: string, options?: ApiMutationOptions) { return this.answer<T>("POST", path, options); }
  async put<T>(path: string, options?: ApiMutationOptions) { return this.answer<T>("PUT", path, options); }
  async delete<T>(path: string, options?: ApiMutationOptions) { return this.answer<T>("DELETE", path, options); }
}

const b2bList = (rows: unknown[]) => ({ code: 200, data: rows, meta: { pagination: { totalCount: rows.length } } });
const v3 = (rows: unknown[]) => ({ data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } });

describe("custom roles", () => {
  const source = () => new Fake({
    "GET /companies/roles": b2bList([{ id: 1, name: "Admin", roleType: 1 }, { id: 9, name: "Approver", roleType: 2 }]),
    "GET /companies/roles/9": { data: { id: 9, permissions: [{ code: "get_orders", permissionLevel: 2 }, { code: "bad", permissionLevel: 7 }] } },
  });

  it("reads only the custom roles, with their valid permissions", async () => {
    expect(await readCustomRoles(source())).toEqual([{ name: "Approver", permissions: [{ code: "get_orders", permissionLevel: 2 }] }]);
  });

  it("creates missing roles and skips ones that exist", async () => {
    const roles = await readCustomRoles(source());
    const target = new Fake({ "GET /companies/roles": b2bList([{ id: 1, name: "Admin" }]), "POST /companies/roles": { code: 200 } });

    expect((await importCustomRoles(target, roles)).created).toBe(1);
    expect(target.writes[0].body).toEqual({ name: "Approver", permissions: [{ code: "get_orders", permissionLevel: 2 }] });

    const again = new Fake({ "GET /companies/roles": b2bList([{ id: 5, name: "approver" }]) });

    expect((await importCustomRoles(again, roles)).skipped).toBe(1);
    expect(again.writes).toEqual([]);
  });
});

describe("quotes", () => {
  const quote = { quoteId: 4, quoteTitle: "Spring order", expiredAt: 4_102_444_800, grandTotal: 20, contactInfo: { name: "Ann", email: "a@x.com", companyName: "Acme" }, productList: [{ sku: "TENT", productName: "Tent", basePrice: 10, offeredPrice: 10, quantity: 2 }] };
  const store = () => new Fake({ "GET /v3/catalog/variants": v3([{ id: 70, product_id: 7, sku: "TENT" }]) });

  it("lists quotes and reads each one in full", async () => {
    const source = new Fake({ "GET /rfq": b2bList([{ quoteId: 4, quoteTitle: "Spring order", company: "Acme" }]), "GET /rfq/4": { data: quote } });

    expect(await listSourceQuotes(source)).toEqual([{ id: 4, title: "Spring order", company: "Acme" }]);
    expect(await readSourceQuotes(source, [4])).toEqual([quote]);
  });

  it("creates a quote for the company with the destination's own product ids", async () => {
    const b2b = new Fake({ "GET /companies": b2bList([{ companyId: 33, companyName: "Acme" }]), "POST /rfq": { code: 200 } });
    const result = await importQuotes({ b2b, store: store() }, [quote]);
    const body = b2b.writes[0].body as { companyId: number; subtotal: number; expiredAt: string; productList: { productId: number; variantId: number }[] };

    expect(result.created).toBe(1);
    expect(body.companyId).toBe(33);
    expect(body.subtotal).toBe(20);
    expect(body.expiredAt).toMatch(/^\d\d\/\d\d\/\d{4}$/);
    expect(body.productList[0]).toMatchObject({ productId: 7, variantId: 70 });
  });

  it("skips quotes whose company or products aren't there, and ones already imported", async () => {
    const noCompany = new Fake({ "GET /companies": b2bList([]) });

    expect((await importQuotes({ b2b: noCompany, store: store() }, [quote])).warnings.join(" ")).toContain("isn't in this store");

    const noProducts = new Fake({ "GET /companies": b2bList([{ companyId: 33, companyName: "Acme" }]) });

    expect((await importQuotes({ b2b: noProducts, store: new Fake() }, [quote])).warnings.join(" ")).toContain("TENT");
    expect(noProducts.writes).toEqual([]);

    const have = new Fake({ "GET /companies": b2bList([{ companyId: 33, companyName: "Acme" }]), "GET /rfq": b2bList([{ company: "Acme", quoteTitle: "Spring order" }]) });

    expect((await importQuotes({ b2b: have, store: store() }, [quote])).skipped).toBe(1);
  });
});

describe("orders", () => {
  const order = { order: { id: 12, status_id: 10, billing_address: { first_name: "Ann", last_name: "Lee", email: "a@x.com", street_1: "1 Road", city: "Austin", state: "Texas", zip: "78701", country: "United States" } }, products: [{ sku: "TENT", name: "Tent", quantity: 2, price_ex_tax: 10, price_inc_tax: 11 }] };

  it("lists the orders B2B Edition holds", async () => {
    expect(await listSourceOrders(new Fake({ "GET /orders": b2bList([{ bcOrderId: 12, companyName: "Acme" }]) }))).toEqual([{ id: 12, company: "Acme" }]);
  });

  it("creates the order for the buyer, then attaches it to the company", async () => {
    const store = new Fake({ "GET /v3/catalog/variants": v3([{ id: 70, product_id: 7, sku: "TENT" }]), "GET /v3/customers": v3([{ id: 501 }]), "POST /v2/orders": { id: 99 } });
    const b2b = new Fake({ "PUT /customers/501/orders/b2b": { code: 200 } });
    const result = await importOrders({ b2b, store }, [order]);

    expect(result.created).toBe(1);
    expect(store.writes[0].body).toMatchObject({ customer_id: 501, status_id: 10, staff_notes: "Imported from Wawaweewa order #12", products: [{ product_id: 7, variant_id: 70, quantity: 2 }] });
    expect(b2b.writes[0].path).toBe("/customers/501/orders/b2b");
  });

  it("skips an order whose buyer or products are missing, or that was already imported", async () => {
    const noBuyer = new Fake({ "GET /v3/catalog/variants": v3([{ id: 70, product_id: 7, sku: "TENT" }]) });

    expect((await importOrders({ b2b: new Fake(), store: noBuyer }, [order])).warnings.join(" ")).toContain("isn't a customer");

    const noProduct = new Fake({ "GET /v3/customers": v3([{ id: 501 }]) });

    expect((await importOrders({ b2b: new Fake(), store: noProduct }, [order])).warnings.join(" ")).toContain("TENT");

    const done = new Fake({ "GET /v3/catalog/variants": v3([{ id: 70, product_id: 7, sku: "TENT" }]), "GET /v3/customers": v3([{ id: 501 }]), "GET /v2/orders": [{ staff_notes: "Imported from Wawaweewa order #12" }] });

    expect((await importOrders({ b2b: new Fake(), store: done }, [order])).skipped).toBe(1);
    expect(done.writes).toEqual([]);
  });
});
