import { describe, expect, it } from "vitest";
import type { ApiMutationOptions, ApiRequestOptions, ApiResponse, BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { captureB2b, importB2b, type B2bData } from "@/lib/samples/sections/b2b";
import { captureCheckout, importCheckout } from "@/lib/samples/sections/checkout";
import { captureInventory, importInventory } from "@/lib/samples/sections/inventory";
import { captureLocalization, importLocalization, type LocalizationData } from "@/lib/samples/sections/localization";
import { capturePricing, importPricing, type PricingData } from "@/lib/samples/sections/pricing";
import { captureStorefront, importStorefront } from "@/lib/samples/sections/storefront";

type Row = Record<string, unknown>;
type Handler = unknown | ((options: { params?: Record<string, unknown>; body?: unknown }) => unknown);

// A store that answers from a table of "METHOD /path" routes and remembers every call. A route can be a
// function of the request, or an Error to throw.
class Scripted implements BcRestApiClient {
  calls: { method: string; path: string; body?: unknown; params?: Record<string, unknown> }[] = [];

  constructor(private readonly routes: Record<string, Handler>) {}

  private answer<T>(method: string, path: string, options: { params?: Record<string, unknown>; body?: unknown }): ApiResponse<T> {
    this.calls.push({ method, path, body: options.body, params: options.params });

    const route = this.routes[`${method} ${path}`];

    if (route === undefined) throw Object.assign(new Error(`${method} ${path} not scripted`), { status: 404 });
    if (route instanceof Error) throw route;

    return { data: (typeof route === "function" ? route(options) : route) as T, headers: new Headers() };
  }

  async get<T>(path: string, options: ApiRequestOptions = {}) {
    return this.answer<T>("GET", path, options);
  }

  async post<T>(path: string, options: ApiMutationOptions = {}) {
    return this.answer<T>("POST", path, options);
  }

  async put<T>(path: string, options: ApiMutationOptions = {}) {
    return this.answer<T>("PUT", path, options);
  }

  async delete<T>(path: string, options: ApiMutationOptions = {}) {
    return this.answer<T>("DELETE", path, options);
  }

  bodies(method: string, path: string): unknown[] {
    return this.calls.filter((call) => call.method === method && call.path === path).map((call) => call.body);
  }
}

const v3 = (rows: Row[]) => ({ data: rows, meta: { pagination: { total: rows.length, count: rows.length, per_page: 250, current_page: 1, total_pages: 1 } } });

describe("pricing", () => {
  const source = () => new Scripted({
    "GET /v2/currencies": [{ id: 1, currency_code: "USD", is_default: true, name: "US Dollar" }, { id: 2, currency_code: "EUR", name: "Euro", currency_exchange_rate: "0.9", token_location: "left", token: "€", decimal_token: ",", thousands_token: ".", decimal_places: 2, enabled: true, is_transactional: false, is_default: false }],
    "GET /v3/pricelists": v3([{ id: 10, name: "Wholesale", active: true }]),
    "GET /v3/pricelists/10/records": v3([{ variant_id: 1, sku: "A", currency: "USD", price: 8, bulk_pricing_tiers: [{ quantity_min: 5, type: "percent", amount: 10 }], calculated_price: 8, product_id: 1 }, { variant_id: 2, sku: "", price: 9 }]),
    "GET /v2/customer_groups": [{ id: 3, name: "VIP" }],
    "GET /v3/channels": v3([{ id: 1, name: "Main" }]),
    "GET /v3/pricelists/assignments": v3([{ price_list_id: 10, customer_group_id: 3, channel_id: 1 }]),
  });

  it("captures prices by SKU and assignments by name, never by source ids", async () => {
    const { data, warnings } = await capturePricing(source());

    expect(data.priceLists).toEqual([{ name: "Wholesale", active: true, records: [{ sku: "A", currency: "USD", price: 8, bulk_pricing_tiers: [{ quantity_min: 5, type: "percent", amount: 10 }] }] }]);
    expect(data.assignments).toEqual([{ priceList: "Wholesale", customerGroup: "VIP", channel: "Main" }]);
    expect(warnings.join(" ")).toContain("no SKU");
  });

  it("adds missing currencies without touching the default, creates the list, finds variants by SKU and assigns it", async () => {
    const { data } = await capturePricing(source());
    const target = new Scripted({
      "GET /v2/currencies": [{ id: 1, currency_code: "USD", is_default: true }],
      "GET /v3/pricelists": v3([]),
      "POST /v2/currencies": {},
      "POST /v3/pricelists": { data: { id: 77 } },
      "GET /v3/catalog/variants": v3([{ id: 900, sku: "A" }]),
      "PUT /v3/pricelists/77/records": {},
      "GET /v2/customer_groups": [{ id: 5, name: "vip" }],
      "GET /v3/channels": v3([{ id: 8, name: "Main" }]),
      "POST /v3/pricelists/assignments": {},
    });
    const result = await importPricing(target, data as PricingData);

    expect(target.bodies("POST", "/v2/currencies")).toHaveLength(1);
    expect(JSON.stringify(target.bodies("POST", "/v2/currencies"))).not.toContain("is_default");
    expect(target.bodies("PUT", "/v3/pricelists/77/records")[0]).toEqual([{ variant_id: 900, currency: "USD", price: 8, bulk_pricing_tiers: [{ quantity_min: 5, type: "percent", amount: 10 }] }]);
    expect(target.bodies("POST", "/v3/pricelists/assignments")[0]).toEqual([{ price_list_id: 77, customer_group_id: 5, channel_id: 8 }]);
    expect(result).toMatchObject({ created: 3, updated: 1, skipped: 1, warnings: [] });
  });

  it("skips prices whose SKU isn't in the store, and says so", async () => {
    const { data } = await capturePricing(source());
    const target = new Scripted({ "GET /v2/currencies": [], "GET /v3/pricelists": v3([]), "POST /v2/currencies": {}, "POST /v3/pricelists": { data: { id: 1 } }, "GET /v3/catalog/variants": v3([]), "GET /v2/customer_groups": [], "GET /v3/channels": v3([]) });
    const result = await importPricing(target, data as PricingData);

    expect(target.bodies("PUT", "/v3/pricelists/1/records")).toEqual([]);
    expect(result.warnings.join(" ")).toContain("Import the catalog first");
    expect(result.warnings.join(" ")).toContain("Assignment of Wholesale");
  });
});

describe("storefront and checkout settings", () => {
  it("captures what the store answers and notes what it refuses", async () => {
    const store = new Scripted({ "GET /v3/settings/storefront/search": { data: { default_product_sort: "featured", search_suggest: true } }, "GET /v3/settings/storefront/seo": new Error("403") });
    const { data, warnings } = await captureStorefront(store);

    expect(data.settings.search).toEqual({ default_product_sort: "featured", search_suggest: true });
    expect(warnings.some((warning) => warning.startsWith("SEO settings"))).toBe(true);
    expect(data.settings.seo).toBeUndefined();
  });

  it("writes each setting over the target's, leaving out unset values", async () => {
    const target = new Scripted({ "PUT /v3/settings/storefront/search": {}, "PUT /v3/settings/catalog": {} });
    const result = await importStorefront(target, { settings: { search: { default_product_sort: "featured", search_suggest: null }, catalog: { a: 1 } } });

    expect(target.bodies("PUT", "/v3/settings/storefront/search")).toEqual([{ default_product_sort: "featured" }]);
    expect(result.updated).toBe(2);
  });

  it("drops checkout files hosted in the source store, keeps the target's contact emails, and never sends read-only fields", async () => {
    const settings = {
      checkout: { checkout_type: "custom", custom_checkout_script_url: "webdav:/content/checkout.js", custom_checkout_sri_hash: "sha256-x", guest_checkout_type: "guest_checkout", order_confirmation_contact_email: "source@example.com", enhanced_checkout_experience: true },
      abandonedCarts: { enable_notification: true, merchant_email_address: "source@example.com" },
    };
    const target = new Scripted({
      "GET /v3/checkouts/settings": { data: { order_confirmation_contact_email: "me@example.com" } },
      "PUT /v3/checkouts/settings": {},
      "GET /v3/abandoned-carts/settings": { data: { merchant_email_address: "me@example.com" } },
      "PUT /v3/abandoned-carts/settings": {},
    });
    const result = await importCheckout(target, { settings });

    expect(target.bodies("PUT", "/v3/checkouts/settings")).toEqual([{ checkout_type: "optimized", guest_checkout_type: "guest_checkout", order_confirmation_contact_email: "me@example.com" }]);
    expect(target.bodies("PUT", "/v3/abandoned-carts/settings")).toEqual([{ enable_notification: true, merchant_email_address: "me@example.com" }]);
    expect(result.warnings.join(" ")).toContain("custom_checkout_script_url");
  });

  it("captures the three checkout areas", async () => {
    const store = new Scripted({ "GET /v3/checkouts/settings": { data: { checkout_type: "optimized" } }, "GET /v3/carts/settings": { data: { allow_purchasing: true } }, "GET /v3/abandoned-carts/settings": { data: { enable_notification: false } } });

    expect(Object.keys((await captureCheckout(store)).data.settings)).toEqual(["checkout", "cart", "abandonedCarts"]);
  });
});

describe("inventory and locations", () => {
  it("captures settings and locations without their ids", async () => {
    const store = new Scripted({ "GET /v3/settings/inventory": { data: { stock_level_display: "show" } }, "GET /v3/inventory/locations": v3([{ id: 4, code: "WH1", label: "Warehouse", type_id: "PHYSICAL", enabled: true, date_created: "x" }]) });
    const { data } = await captureInventory(store);

    expect(data.settings.inventory).toEqual({ stock_level_display: "show" });
    expect(data.locations).toEqual([{ code: "WH1", label: "Warehouse", type_id: "PHYSICAL", enabled: true }]);
  });

  it("updates a location with the same code and adds the others", async () => {
    const target = new Scripted({ "PUT /v3/settings/inventory": {}, "GET /v3/inventory/locations": v3([{ id: 9, code: "wh1" }]), "PUT /v3/inventory/locations": {}, "POST /v3/inventory/locations": { transaction_id: "t" } });
    const result = await importInventory(target, { settings: { inventory: { stock_level_display: "show" } }, locations: [{ code: "WH1", label: "Warehouse" }, { code: "SHOP", label: "Shop" }] });

    expect(target.bodies("PUT", "/v3/inventory/locations")).toEqual([[{ id: 9, code: "WH1", label: "Warehouse" }]]);
    expect(target.bodies("POST", "/v3/inventory/locations")).toEqual([[{ code: "SHOP", label: "Shop" }]]);
    expect(result).toMatchObject({ created: 1, updated: 2 });
  });

  it("reports a location the plan doesn't allow instead of failing the section", async () => {
    const target = new Scripted({ "PUT /v3/settings/inventory": {}, "GET /v3/inventory/locations": v3([]), "POST /v3/inventory/locations": Object.assign(new Error("plan"), { detail: "Location limit reached" }) });
    const result = await importInventory(target, { settings: {}, locations: [{ code: "X" }] });

    expect(result.warnings).toEqual(["Location X: Location limit reached"]);
  });
});

describe("localization", () => {
  const graphql = (handlers: Record<string, (variables: Row) => unknown>) => (options: { body?: unknown }) => {
    const { query, variables } = options.body as { query: string; variables: Row };
    const name = Object.keys(handlers).find((key) => query.includes(key));

    return { data: name ? handlers[name](variables) : {} };
  };

  it("captures channel languages and translated product fields by SKU", async () => {
    const store = new Scripted({
      "GET /v3/channels": v3([{ id: 1, name: "Main" }]),
      "GET /v3/catalog/products": v3([{ id: 50, sku: "A" }]),
      "POST /graphql": graphql({
        "locales(": () => ({ store: { locales: { edges: [{ node: { code: "en", status: "ACTIVE", isDefault: true } }, { node: { code: "fr", status: "ACTIVE", isDefault: false } }] } } }),
        "translations(": () => ({ store: { translations: { edges: [{ node: { resourceId: "bc/store/product/50", fields: [{ fieldName: "name", translation: "Tente" }, { fieldName: "description", translation: "" }] } }], pageInfo: { hasNextPage: false } } } }),
      }),
    });
    const { data } = await captureLocalization(store);

    expect(data.languages).toEqual(["en", "fr"]);
    expect(data.defaultLanguage).toBe("en");
    expect(data.translations).toEqual([{ channel: "Main", locale: "fr", products: [{ sku: "A", fields: { name: "Tente" } }] }]);
  });

  const file: LocalizationData = { channels: [{ name: "Main", locales: [{ code: "en", status: "ACTIVE", isDefault: true }, { code: "fr", status: "ACTIVE", isDefault: false }] }], translations: [{ channel: "Main", locale: "fr", products: [{ sku: "A", fields: { name: "Tente" } }, { sku: "GONE", fields: { name: "x" } }] }], languages: ["en", "fr"], defaultLanguage: "en" };

  it("adds the missing language, makes the chosen one the default, and translates the products it finds", async () => {
    const seen: string[] = [];
    const target = new Scripted({
      "GET /v3/channels": v3([{ id: 7, name: "main" }]),
      "GET /v3/catalog/products": v3([{ id: 70, sku: "A" }]),
      "POST /graphql": graphql({
        "locales(": () => ({ store: { locales: { edges: [{ node: { code: "en", status: "ACTIVE", isDefault: true } }] } } }),
        "addLocale": (variables) => (seen.push(`add ${JSON.stringify(variables)}`), { locale: { addLocale: { errors: [] } } }),
        "updateLocale": (variables) => (seen.push(`update ${JSON.stringify(variables)}`), { locale: { updateLocale: { errors: [] } } }),
        "updateTranslations": (variables) => (seen.push(`translate ${JSON.stringify(variables)}`), { translation: { updateTranslations: { errors: [] } } }),
      }),
    });
    const result = await importLocalization(target, file, { defaultLanguage: "fr" });

    expect(seen[0]).toContain('"code":"fr"');
    expect(seen[0]).toContain("bc/store/channel/7");
    expect(seen[1]).toContain('"isDefault":true');
    expect(seen[2]).toContain("bc/store/product/70");
    expect(seen[2]).not.toContain("GONE");
    expect(result.warnings.join(" ")).toContain("1 products skipped");
  });

  it("turns a GraphQL error into a warning", async () => {
    const target = new Scripted({
      "GET /v3/channels": v3([{ id: 7, name: "Main" }]),
      "GET /v3/catalog/products": v3([]),
      "POST /graphql": graphql({
        "locales(": () => ({ store: { locales: { edges: [] } } }),
        "addLocale": () => ({ locale: { addLocale: { errors: [{ message: "Too many locales" }] } } }),
      }),
    });
    const result = await importLocalization(target, { ...file, translations: [] });

    expect(result.warnings.join(" ")).toContain("Too many locales");
  });
});

describe("B2B Edition", () => {
  const b2b = (extra: Record<string, Handler> = {}) => new Scripted({
    "GET /companies": { data: [{ companyId: 1, companyName: "Acme", companyEmail: "a@acme.test", companyPhone: "1", city: "Austin", country: "US" }], meta: { pagination: { totalCount: 1 } } },
    "GET /users": { data: [{ firstName: "Ada", lastName: "Admin", email: "ada@acme.test", role: 0 }, { firstName: "Bob", lastName: "Buyer", email: "bob@acme.test", role: 2 }] },
    ...extra,
  });

  it("captures companies with their users", async () => {
    const { data, warnings } = await captureB2b(new Scripted({}), { b2b: async () => b2b() });

    expect(data.companies).toHaveLength(1);
    expect(data.companies[0]).toMatchObject({ companyName: "Acme", city: "Austin", users: [{ email: "ada@acme.test", role: 0 }, { email: "bob@acme.test", role: 2 }] });
    expect(warnings.join(" ")).toContain("Quotes, orders");
  });

  it("creates a company with its admin, then its other users, and skips one that exists", async () => {
    const { data } = await captureB2b(new Scripted({}), { b2b: async () => b2b() });
    const target = new Scripted({ "GET /companies": { data: [{ companyId: 9, companyName: "Other" }] }, "POST /companies": { data: { companyId: 55 } }, "POST /users": {} });
    const result = await importB2b(new Scripted({}), data as B2bData, { b2b: async () => target });

    expect(target.bodies("POST", "/companies")[0]).toMatchObject({ companyName: "Acme", adminEmail: "ada@acme.test", adminFirstName: "Ada" });
    expect(target.bodies("POST", "/users")).toEqual([{ companyId: 55, email: "bob@acme.test", firstName: "Bob", lastName: "Buyer", phoneNumber: "", role: 2 }]);
    expect(result.created).toBe(2);

    const again = new Scripted({ "GET /companies": { data: [{ companyId: 1, companyName: "acme" }] } });

    expect((await importB2b(new Scripted({}), data as B2bData, { b2b: async () => again })).skipped).toBe(1);
  });

  it("explains when B2B Edition can't be reached", async () => {
    expect((await captureB2b(new Scripted({}))).warnings[0]).toContain("B2B Edition couldn't be reached");
    expect((await importB2b(new Scripted({}), { companies: [] })).warnings[0]).toContain("couldn't be reached");

    const refusing = new Scripted({ "GET /companies": Object.assign(new Error("401"), { status: 401 }) });

    expect((await captureB2b(new Scripted({}), { b2b: async () => refusing })).warnings.join(" ")).toContain("refused the token (HTTP 401)");
  });
});
