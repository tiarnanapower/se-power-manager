import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { clearSectionStep, isClearable, previewClearSection } from "@/lib/samples/sections/clear";

// A fake store: answers reads from a table and records every delete. A path in `refuse` fails when deleted.
class Fake implements BcRestApiClient {
  deletes: string[] = [];

  constructor(private readonly routes: Record<string, unknown> = {}, private readonly refuse: string[] = []) {}

  async get<T>(path: string, _options?: ApiRequestOptions): Promise<ApiResponse<T>> {
    return { data: (this.routes[path] ?? []) as T, headers: new Headers() };
  }

  async post<T>(_path: string, _options?: ApiMutationOptions): Promise<ApiResponse<T>> { throw new Error("clearing never creates"); }
  async put<T>(_path: string, _options?: ApiMutationOptions): Promise<ApiResponse<T>> { throw new Error("clearing never updates"); }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    if (this.refuse.includes(path)) throw Object.assign(new Error("refused"), { detail: "can't delete the default" });

    this.deletes.push(path);

    return { data: undefined as T, headers: new Headers() };
  }
}

const v3 = (rows: unknown[]) => ({ data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } });
const b2b = (rows: unknown[]) => ({ code: 200, data: rows, meta: { pagination: { totalCount: rows.length } } });

describe("clearing other sections", () => {
  it("knows which sections can be cleared", () => {
    expect(["b2b", "pricing", "shipping", "tax", "inventory"].every(isClearable)).toBe(true);
    expect(["catalog", "storefront", "checkout", "localization"].some(isClearable)).toBe(false);
  });

  it("removes shipping zones and methods but keeps the default zone, with its methods removed", async () => {
    const store = new Fake({
      "/v2/shipping/zones": [{ id: 1, name: "Rest of the world", type: "global" }, { id: 2, name: "US", type: "country" }],
      "/v2/shipping/zones/1/methods": [{ id: 11 }],
      "/v2/shipping/zones/2/methods": [{ id: 21 }, { id: 22 }],
    });

    expect((await previewClearSection(store, "shipping")).count).toBe(2);
    expect((await clearSectionStep(store, "shipping")).deleted).toBe(2);
    expect(store.deletes).toEqual(["/v2/shipping/zones/1/methods/11", "/v2/shipping/zones/2/methods/21", "/v2/shipping/zones/2/methods/22", "/v2/shipping/zones/2"]);
  });

  it("keeps the last zone when there is no default zone, and has nothing left to do once its methods are gone", async () => {
    const store = new Fake({ "/v2/shipping/zones": [{ id: 7, name: "United Kingdom", type: "country" }], "/v2/shipping/zones/7/methods": [{ id: 70 }] });

    await clearSectionStep(store, "shipping");

    expect(store.deletes).toEqual(["/v2/shipping/zones/7/methods/70"]);
    expect((await previewClearSection(new Fake({ "/v2/shipping/zones": [{ id: 7, name: "United Kingdom", type: "country" }] }), "shipping")).count).toBe(0);
  });

  it("removes tax rates and zones, never the default zone, and never touches tax classes", async () => {
    const store = new Fake({ "/v3/tax/rates": v3([{ id: 5, name: "VAT" }]), "/v3/tax/zones": v3([{ id: 1, name: "Default Zone" }, { id: 3, name: "UK" }]), "/v2/tax_classes": [{ id: 4, name: "Food" }] });

    await clearSectionStep(store, "tax");

    expect(store.deletes).toEqual(["/v3/tax/rates?id:in=5", "/v3/tax/zones?id:in=3"]);
  });

  it("removes price lists and extra currencies, never the default currency", async () => {
    const store = new Fake({ "/v3/pricelists": v3([{ id: 8, name: "Wholesale" }]), "/v2/currencies": [{ id: 1, currency_code: "USD", is_default: true }, { id: 2, currency_code: "EUR", is_default: false }] });

    await clearSectionStep(store, "pricing");

    expect(store.deletes).toEqual(["/v3/pricelists/8", "/v2/currencies/2"]);
  });

  it("removes stock locations", async () => {
    const store = new Fake({ "/v3/inventory/locations": v3([{ id: 1, label: "Default location", code: "BC-LOCATION-1" }, { id: 6, label: "Warehouse" }]) });

    expect((await clearSectionStep(store, "inventory")).deleted).toBe(1);
    expect(store.deletes).toEqual(["/v3/inventory/locations?location_id:in=6"]);
  });

  it("removes B2B companies, then custom roles only", async () => {
    const target = new Fake({ "/companies": b2b([{ companyId: 40, companyName: "Acme" }]), "/companies/roles": b2b([{ id: 1, name: "Admin", roleType: 1 }, { id: 9, name: "Approver", roleType: 2 }]) });

    await clearSectionStep(new Fake(), "b2b", { b2b: async () => target });

    expect(target.deletes).toEqual(["/companies/40", "/companies/roles/9"]);
  });

  it("does only a few at a time, says how many are left, and reports what can't be deleted", async () => {
    const store = new Fake({ "/v3/pricelists": v3([{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }]) }, ["/v3/pricelists/2"]);
    const step = await clearSectionStep(store, "pricing", {}, 2);

    expect(step.deleted).toBe(1);
    expect(step.remaining).toBe(2);
    expect(step.warnings[0]).toContain("can't delete the default");
  });
});
