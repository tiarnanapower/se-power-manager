import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { captureShipping, importShipping, type ShippingData } from "@/lib/samples/sections/shipping";
import { captureTax, importTax, type TaxData } from "@/lib/samples/sections/tax";

type Row = Record<string, unknown>;

// A tiny store holding the shipping and tax resources, speaking v2 (bare arrays) and v3 ({ data }).
class FakeStore implements BcRestApiClient {
  zones: Row[] = [{ id: 1, name: "Global", type: "global", enabled: true }];
  methods: Record<number, Row[]> = { 1: [] };
  taxZones: Row[] = [{ id: 1, name: "Default Zone", enabled: true }];
  taxRates: Row[] = [];
  taxClasses: Row[] = [{ id: 0, name: "Default Tax Class" }, { id: 7, name: "Wine" }];
  taxSettings: Row = { price_display_settings: { show_inclusive_in_control_panel: true }, store_tax_zone_id: 1 };
  calls: string[] = [];
  failing = new Set<string>();
  private next = 50;

  private reply<T>(data: unknown): ApiResponse<T> {
    return { data: data as T, headers: new Headers() };
  }

  private v3(rows: Row[]) {
    return { data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } };
  }

  async get<T>(path: string, _options?: ApiRequestOptions) {
    if (this.failing.has(path)) throw new Error(`GET ${path} refused`);
    if (path === "/v2/shipping/zones") return this.reply<T>(this.zones);
    if (path === "/v3/tax/zones") return this.reply<T>(this.v3(this.taxZones));
    if (path === "/v3/tax/rates") return this.reply<T>(this.v3(this.taxRates));
    if (path === "/v3/tax/settings") return this.reply<T>({ data: this.taxSettings });
    if (path === "/v2/tax_classes") return this.reply<T>(this.taxClasses);

    const methods = path.match(/^\/v2\/shipping\/zones\/(\d+)\/methods$/);

    if (methods) return this.reply<T>(this.methods[Number(methods[1])] ?? []);

    throw new Error(`unexpected GET ${path}`);
  }

  async post<T>(path: string, options: ApiMutationOptions = {}) {
    this.calls.push(`POST ${path}`);

    const body = options.body as Row | Row[];

    if (path === "/v2/shipping/zones") {
      const zone = { ...(body as Row), id: this.next++ };

      this.zones.push(zone);
      this.methods[zone.id as number] = [];

      return this.reply<T>(zone);
    }

    const methods = path.match(/^\/v2\/shipping\/zones\/(\d+)\/methods$/);

    if (methods) {
      const method = { ...(body as Row), id: this.next++ };

      this.methods[Number(methods[1])].push(method);

      return this.reply<T>(method);
    }

    if (path === "/v3/tax/zones") {
      const zone = { ...(body as Row[])[0], id: this.next++ };

      this.taxZones.push(zone);

      return this.reply<T>({ data: [zone] });
    }

    if (path === "/v3/tax/rates") {
      const rate = { ...(body as Row[])[0], id: this.next++ };

      this.taxRates.push(rate);

      return this.reply<T>({ data: [rate] });
    }

    throw new Error(`unexpected POST ${path}`);
  }

  async put<T>(path: string, options: ApiMutationOptions = {}) {
    this.calls.push(`PUT ${path} ${JSON.stringify(options.body)}`);

    if (path === "/v3/tax/settings") this.taxSettings = options.body as Row;

    return this.reply<T>({});
  }

  async delete<T>(): Promise<ApiResponse<T>> { throw new Error("nothing is ever deleted"); }
}

describe("shipping section", () => {
  const sample: ShippingData = {
    zones: [{ id: 1, name: "Global", type: "global" }, { id: 9, name: "Europe", type: "country", enabled: true, locations: [{ id: 3, country_iso2: "FR" }] }],
    methods: { "1": [{ id: 4, name: "Free", type: "freeshipping", enabled: true, settings: {} }], "9": [{ id: 5, name: "Flat rate", type: "perorder", enabled: true, settings: { rate: 5 }, channel_ids: [99] }] },
  };

  it("captures zones and their methods, and turns a refusal into a warning", async () => {
    const store = new FakeStore();

    store.zones.push({ id: 9, name: "Europe", type: "country" });
    store.methods[9] = [{ id: 5, name: "Flat rate" }];
    store.failing.add("/v2/shipping/zones/1/methods");

    const { data, warnings } = await captureShipping(store);

    expect(data.zones.map((zone) => zone.name)).toEqual(["Global", "Europe"]);
    expect(data.methods["9"]).toHaveLength(1);
    expect(warnings[0]).toContain("Methods for zone Global");
  });

  it("creates the zone and methods, leaves the global zone alone, and strips source ids", async () => {
    const store = new FakeStore();
    const result = await importShipping(store, sample);

    // One new zone and two new methods; the global zone itself is left alone.
    expect(result).toMatchObject({ created: 3, skipped: 1, warnings: [] });
    expect(store.zones.map((zone) => zone.name)).toEqual(["Global", "Europe"]);
    expect(store.zones[1].locations).toEqual([{ country_iso2: "FR" }]);
    expect(store.methods[1].map((method) => method.name)).toEqual(["Free"]);
    expect(store.methods[store.zones[1].id as number][0]).not.toHaveProperty("channel_ids");
    expect(store.calls.some((call) => call.startsWith("PUT /v2/shipping/zones/1 "))).toBe(false);
  });

  it("doesn't duplicate anything when imported twice", async () => {
    const store = new FakeStore();

    await importShipping(store, sample);
    const again = await importShipping(store, sample);

    expect(store.zones).toHaveLength(2);
    expect(store.methods[store.zones[1].id as number]).toHaveLength(1);
    expect(again.created).toBe(0);
  });
});

describe("tax section", () => {
  const sample: TaxData = {
    settings: { price_display_settings: { show_inclusive_in_control_panel: false }, store_tax_zone_id: 1, guest_shopper_tax_zone_id: 20 },
    zones: [{ id: 1, name: "Default Zone", enabled: true, shopper_target_settings: { locations: [] } }, { id: 20, name: "UK", enabled: true, locations: [{ country_code: "GB" }] }],
    rates: [{ id: 5, name: "VAT", enabled: true, priority: 1, tax_zone_id: 20, class_rates: [{ tax_class_id: 0, rate: 20 }, { tax_class_id: 3, rate: 5 }] }, { id: 6, name: "Orphan", tax_zone_id: 999, class_rates: [] }],
    classes: [{ id: 0, name: "Default Tax Class" }, { id: 3, name: "Wine" }],
  };

  it("captures settings, zones, rates and classes", async () => {
    const { data, warnings } = await captureTax(new FakeStore());

    expect(data.zones).toHaveLength(1);
    expect(data.classes).toHaveLength(2);
    expect(data.settings).toMatchObject({ store_tax_zone_id: 1 });
    expect(warnings).toEqual([]);
  });

  it("maps zones and tax classes by name, leaves the default zone's targeting alone, and skips orphan rates", async () => {
    const store = new FakeStore();
    const result = await importTax(store, sample);
    const uk = store.taxZones.find((zone) => zone.name === "UK");
    const vat = store.taxRates[0];

    expect(result.warnings).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(uk).toBeDefined();
    expect(vat).toMatchObject({ name: "VAT", tax_zone_id: uk?.id });
    // The destination's "Wine" class has a different id (7) from the sample's (3).
    expect(vat.class_rates).toEqual([{ tax_class_id: 0, rate: 20 }, { tax_class_id: 7, rate: 5 }]);
    expect(store.calls.find((call) => call.startsWith("PUT /v3/tax/zones"))).not.toContain("shopper_target_settings");
  });

  it("rewrites settings: zone ids follow the destination, and the old display flag becomes a strategy", async () => {
    const store = new FakeStore();

    await importTax(store, sample);

    const uk = store.taxZones.find((zone) => zone.name === "UK");
    const settings = store.taxSettings as { price_display_settings: Row; guest_shopper_tax_zone_id: number; store_tax_zone_id: number };

    expect(settings.guest_shopper_tax_zone_id).toBe(uk?.id);
    expect(settings.store_tax_zone_id).toBe(1);
    expect(settings.price_display_settings).toEqual({ control_panel_price_display_strategy: "EXCLUSIVE" });
  });

  it("reports a refused zone and keeps going", async () => {
    const store = new FakeStore();
    const post = store.post.bind(store);

    store.post = (async (path: string, options?: ApiMutationOptions) => {
      if (path === "/v3/tax/zones") throw Object.assign(new Error("no"), { detail: "scope missing" });

      return post(path, options);
    }) as typeof store.post;

    const result = await importTax(store, sample);

    expect(result.warnings[0]).toBe("Tax zone UK: scope missing");
  });
});
