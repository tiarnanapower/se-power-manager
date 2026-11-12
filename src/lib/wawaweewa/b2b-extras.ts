// What Wawaweewa copies beyond companies and users: custom roles, quotes and orders. Every function takes
// clients, so it is tested with fakes and never needs the environment. The source is only ever read.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { first, readB2b } from "@/lib/samples/sections/b2b";
import { asRecord, describe, emptyResult, key, positiveInt, readAll, records, text, type JsonRecord, type SectionResult } from "@/lib/samples/sections/shared";

const DAY = 86_400_000;

// ---------- Custom roles ----------

export interface RoleCopy {
  name: string;
  permissions: { code: string; permissionLevel: number }[];
}

// Custom roles only: the predefined ones (admin, senior buyer, junior buyer) exist in every store.
export async function readCustomRoles(source: BcRestApiClient): Promise<RoleCopy[]> {
  const roles: RoleCopy[] = [];

  for (const row of await readB2b(source, "/companies/roles")) {
    const id = positiveInt(row.id);

    if (!id || Number(row.roleType) !== 2 || !first(row, "name")) continue;

    const { data } = await source.get<unknown>(`/companies/roles/${id}`);
    const detail = asRecord(asRecord(data)?.data);
    const permissions = records(detail?.permissions).flatMap((permission) => {
      const code = text(permission.code);
      const level = Number(permission.permissionLevel);

      return code && (level === 1 || level === 2) ? [{ code, permissionLevel: level }] : [];
    });

    roles.push({ name: first(row, "name"), permissions });
  }

  return roles;
}

export async function importCustomRoles(target: BcRestApiClient, roles: RoleCopy[]): Promise<SectionResult> {
  const result = emptyResult();
  const existing = new Set((await readB2b(target, "/companies/roles")).map((row) => key(first(row, "name"))));

  for (const role of roles) {
    if (existing.has(key(role.name))) {
      result.skipped += 1;
      continue;
    }

    try {
      await target.post("/companies/roles", { body: { name: role.name, permissions: role.permissions } });
      existing.add(key(role.name));
      result.created += 1;
    } catch (error) {
      result.warnings.push(`Role ${role.name}: ${describe(error)}`);
    }
  }

  return result;
}

// ---------- Shared lookups in the destination ----------

async function companyIdsByName(target: BcRestApiClient): Promise<Map<string, number>> {
  const ids = new Map<string, number>();

  for (const row of await readB2b(target, "/companies")) {
    const id = positiveInt(row.companyId ?? row.id);

    if (id && first(row, "companyName", "name")) ids.set(key(first(row, "companyName", "name")), id);
  }

  return ids;
}

interface Match { productId: number; variantId?: number }

// Where a SKU lives in the destination: a variant's SKU first, then a product's.
async function matchBySku(store: BcRestApiClient, skus: string[]): Promise<Map<string, Match>> {
  const found = new Map<string, Match>();
  const unique = [...new Set(skus.filter(Boolean))];

  for (let start = 0; start < unique.length; start += 50) {
    const chunk = unique.slice(start, start + 50).join(",");

    for (const row of await readAll(store, "/v3/catalog/variants", { "sku:in": chunk })) {
      const productId = positiveInt(row.product_id);

      if (productId && text(row.sku) && !found.has(text(row.sku))) found.set(text(row.sku), { productId, variantId: positiveInt(row.id) });
    }

    for (const row of await readAll(store, "/v3/catalog/products", { "sku:in": chunk, include_fields: "id,sku" })) {
      const productId = positiveInt(row.id);

      if (productId && text(row.sku) && !found.has(text(row.sku))) found.set(text(row.sku), { productId });
    }
  }

  return found;
}

// ---------- Quotes ----------

export interface QuoteRef { id: number; title: string; company: string }

export async function listSourceQuotes(source: BcRestApiClient): Promise<QuoteRef[]> {
  return (await readB2b(source, "/rfq")).flatMap((row) => {
    const id = positiveInt(row.quoteId ?? row.id);

    return id ? [{ id, title: first(row, "quoteTitle", "title"), company: first(row, "company", "companyName") }] : [];
  });
}

export async function readSourceQuotes(source: BcRestApiClient, ids: number[]): Promise<JsonRecord[]> {
  const quotes: JsonRecord[] = [];

  for (const id of ids) {
    const { data } = await source.get<unknown>(`/rfq/${id}`);
    const quote = asRecord(asRecord(data)?.data);

    if (quote) quotes.push(quote);
  }

  return quotes;
}

// B2B Edition wants an expiry as MM/DD/YYYY. A quote that has already expired is given a month from now.
function expiry(value: unknown): string {
  const seconds = Number(value);
  const date = Number.isFinite(seconds) && seconds > 0 && seconds * 1000 > Date.now() ? new Date(seconds * 1000) : new Date(Date.now() + 30 * DAY);

  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

export async function importQuotes(target: { b2b: BcRestApiClient; store: BcRestApiClient }, quotes: JsonRecord[]): Promise<SectionResult> {
  const result = emptyResult();
  const companies = await companyIdsByName(target.b2b);
  const have = new Set((await readB2b(target.b2b, "/rfq")).map((row) => `${key(first(row, "company", "companyName"))}|${key(first(row, "quoteTitle", "title"))}`));
  const lines = quotes.flatMap((quote) => records(quote.productList));
  const matches = await matchBySku(target.store, lines.map((line) => text(line.sku)));

  for (const quote of quotes) {
    const title = first(quote, "quoteTitle", "title");
    const contact = asRecord(quote.contactInfo) ?? {};
    const companyName = first(contact, "companyName") || first(quote, "company", "companyName");
    const label = title || `Quote ${text(quote.quoteNumber) || text(quote.quoteId)}`;
    const companyId = companies.get(key(companyName));

    if (have.has(`${key(companyName)}|${key(title)}`)) {
      result.skipped += 1;
      continue;
    }

    if (!companyId) {
      result.warnings.push(`${label}: skipped, because the company "${companyName}" isn't in this store. Import the companies first.`);
      continue;
    }

    const missing: string[] = [];
    const productList = records(quote.productList).flatMap((line) => {
      const match = matches.get(text(line.sku));

      if (!match) {
        missing.push(text(line.sku) || text(line.productName) || "a product");

        return [];
      }

      const basePrice = Number(line.basePrice ?? 0);
      const offeredPrice = Number(line.offeredPrice ?? basePrice);

      return [{ productId: match.productId, ...(match.variantId ? { variantId: match.variantId } : {}), productName: text(line.productName) || text(line.sku), sku: text(line.sku), basePrice, offeredPrice, quantity: Math.max(1, Number(line.quantity ?? 1)), discount: Number(line.discount ?? 0), options: [] }];
    });

    if (missing.length > 0 || productList.length === 0) {
      result.warnings.push(`${label}: skipped, because ${missing.length ? `these products aren't in this store (import the catalog first): ${missing.slice(0, 5).join(", ")}` : "it has no products"}.`);
      continue;
    }

    const subtotal = productList.reduce((sum, line) => sum + line.offeredPrice * line.quantity, 0);

    try {
      await target.b2b.post("/rfq", {
        body: {
          quoteTitle: title,
          companyId,
          subtotal,
          discount: Number(quote.discount ?? 0),
          grandTotal: Number(quote.grandTotal ?? subtotal),
          expiredAt: expiry(quote.expiredAt),
          contactInfo: { name: first(contact, "name"), email: first(contact, "email"), companyName, phoneNumber: first(contact, "phoneNumber") },
          productList,
        },
      });
      have.add(`${key(companyName)}|${key(title)}`);
      result.created += 1;
    } catch (error) {
      result.warnings.push(`${label}: ${describe(error)}`);
    }
  }

  return result;
}

// ---------- Orders ----------

export interface OrderRef { id: number; company: string }

// The orders B2B Edition knows belong to a company.
export async function listSourceOrders(source: BcRestApiClient): Promise<OrderRef[]> {
  return (await readB2b(source, "/orders")).flatMap((row) => {
    const id = positiveInt(row.bcOrderId ?? row.orderId);

    return id ? [{ id, company: first(row, "companyName", "company") }] : [];
  });
}

export interface SourceOrder { order: JsonRecord; products: JsonRecord[] }

export async function readSourceOrders(source: BcRestApiClient, ids: number[]): Promise<SourceOrder[]> {
  const orders: SourceOrder[] = [];

  for (const id of ids) {
    const [order, products] = await Promise.all([source.get<unknown>(`/v2/orders/${id}`), source.get<unknown>(`/v2/orders/${id}/products`)]);
    const body = asRecord(order.data);

    if (body) orders.push({ order: body, products: records(products.data) });
  }

  return orders;
}

const marker = (id: unknown) => `Imported from Wawaweewa order #${text(String(id))}`;

// Orders are ordinary store orders, so they are created through the store API for the buyer's customer
// account, then attached to the company. The buyer has to exist already (import companies and users first).
export async function importOrders(target: { b2b: BcRestApiClient; store: BcRestApiClient }, orders: SourceOrder[]): Promise<SectionResult> {
  const result = emptyResult();
  const matches = await matchBySku(target.store, orders.flatMap((entry) => entry.products.map((product) => text(product.sku))));

  for (const { order, products } of orders) {
    const label = `Order #${text(String(order.id))}`;
    const billing = asRecord(order.billing_address) ?? {};
    const email = text(billing.email);

    if (!email) {
      result.warnings.push(`${label}: skipped, because it has no buyer email.`);
      continue;
    }

    const customers = await readAll(target.store, "/v3/customers", { "email:in": email });
    const customerId = positiveInt(customers[0]?.id);

    if (!customerId) {
      result.warnings.push(`${label}: skipped, because ${email} isn't a customer in this store. Import the companies and users first.`);
      continue;
    }

    const earlier = await target.store.get<unknown>("/v2/orders", { params: { customer_id: customerId, limit: 250 } }).then((response) => records(response.data), () => [] as JsonRecord[]);

    if (earlier.some((row) => text(row.staff_notes) === marker(order.id))) {
      result.skipped += 1;
      continue;
    }

    const missing: string[] = [];
    const lines = products.flatMap((product) => {
      const match = matches.get(text(product.sku));

      if (!match) {
        missing.push(text(product.sku) || text(product.name) || "a product");

        return [];
      }

      return [{ product_id: match.productId, ...(match.variantId ? { variant_id: match.variantId } : {}), quantity: Math.max(1, Number(product.quantity ?? 1)), price_ex_tax: Number(product.price_ex_tax ?? product.base_price ?? 0), price_inc_tax: Number(product.price_inc_tax ?? product.base_price ?? 0) }];
    });

    if (missing.length > 0 || lines.length === 0) {
      result.warnings.push(`${label}: skipped, because ${missing.length ? `these products aren't in this store (import the catalog first): ${missing.slice(0, 5).join(", ")}` : "it has no products"}.`);
      continue;
    }

    try {
      await target.store.post("/v2/orders", {
        body: {
          customer_id: customerId,
          status_id: positiveInt(order.status_id) ?? 1,
          date_created: text(order.date_created) || undefined,
          billing_address: { first_name: text(billing.first_name), last_name: text(billing.last_name), company: text(billing.company), street_1: text(billing.street_1), street_2: text(billing.street_2), city: text(billing.city), state: text(billing.state), zip: text(billing.zip), country: text(billing.country), phone: text(billing.phone), email },
          products: lines,
          staff_notes: marker(order.id),
        },
      });
      await target.b2b.put(`/customers/${customerId}/orders/b2b`).catch((error) => {
        result.warnings.push(`${label}: created, but couldn't be attached to the company (${describe(error)}).`);
      });
      result.created += 1;
    } catch (error) {
      result.warnings.push(`${label}: ${describe(error)}`);
    }
  }

  return result;
}
