// Pricing & currencies: currencies, price lists, their price records and where each list is assigned.
// Import is additive: currencies and price lists are matched by code and name, records are matched to
// variants by SKU (so import the catalog first), and nothing is removed. The store's default currency is
// never changed.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { asRecord, attempt, describe, emptyResult, key, pick, positiveInt, readAll, records, text, type JsonRecord, type SectionFile, type SectionResult } from "@/lib/samples/sections/shared";

export interface PricingData {
  currencies: JsonRecord[];
  priceLists: { name: string; active: boolean; records: JsonRecord[] }[];
  // Where each list applies. Groups and channels are named, because their ids belong to the source store.
  assignments: { priceList: string; customerGroup: string | null; channel: string | null }[];
}

const CURRENCY_FIELDS = ["name", "currency_code", "currency_exchange_rate", "token_location", "token", "decimal_token", "thousands_token", "decimal_places", "enabled", "is_transactional", "country_iso2", "auto_update"] as const;
const RECORD_FIELDS = ["sku", "currency", "price", "sale_price", "retail_price", "map_price", "bulk_pricing_tiers"] as const;
const CHUNK = 1000;

export async function capturePricing(client: BcRestApiClient): Promise<SectionFile<PricingData>> {
  const warnings: string[] = [];
  const currencies = await attempt("Currencies", warnings, () => readAll(client, "/v2/currencies"), [] as JsonRecord[]);
  const lists = await attempt("Price lists", warnings, () => readAll(client, "/v3/pricelists"), [] as JsonRecord[]);
  const priceLists: PricingData["priceLists"] = [];
  let unnamed = 0;

  for (const list of lists) {
    const id = positiveInt(list.id);

    if (!id) continue;

    const rows = await attempt(`Prices in ${text(list.name)}`, warnings, () => readAll(client, `/v3/pricelists/${id}/records`, { include: "bulk_pricing_tiers,sku" }), [] as JsonRecord[]);
    const kept = rows.filter((row) => text(row.sku)).map((row) => pick(row, RECORD_FIELDS));

    unnamed += rows.length - kept.length;
    priceLists.push({ name: text(list.name), active: list.active !== false, records: kept });
  }

  if (unnamed > 0) warnings.push(`${unnamed} price records were left out because their variant has no SKU to find it by.`);

  const groups = await attempt("Customer groups", warnings, () => readAll(client, "/v2/customer_groups"), [] as JsonRecord[]);
  const channels = await attempt("Channels", warnings, () => readAll(client, "/v3/channels"), [] as JsonRecord[]);
  const assignmentRows = await attempt("Price list assignments", warnings, () => readAll(client, "/v3/pricelists/assignments"), [] as JsonRecord[]);
  const nameOf = (rows: JsonRecord[], id: unknown) => text(rows.find((row) => Number(row.id) === Number(id))?.name) || null;
  const assignments = assignmentRows.flatMap((row) => {
    const priceList = nameOf(lists, row.price_list_id);

    return priceList ? [{ priceList, customerGroup: nameOf(groups, row.customer_group_id), channel: nameOf(channels, row.channel_id) }] : [];
  });

  return { data: { currencies, priceLists, assignments }, warnings };
}

// The variant of each SKU, looked up 50 at a time.
async function variantsBySku(client: BcRestApiClient, skus: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const unique = [...new Set(skus)];

  for (let start = 0; start < unique.length; start += 50) {
    for (const row of await readAll(client, "/v3/catalog/variants", { "sku:in": unique.slice(start, start + 50).join(",") })) {
      const id = positiveInt(row.id);

      if (id && text(row.sku) && !found.has(text(row.sku))) found.set(text(row.sku), id);
    }
  }

  return found;
}

export async function importPricing(client: BcRestApiClient, file: PricingData): Promise<SectionResult> {
  const result = emptyResult();

  // Currencies: add the ones the store doesn't have.
  const targetCurrencies = await readAll(client, "/v2/currencies").catch((error) => {
    result.warnings.push(`Currencies: ${describe(error)}`);

    return [] as JsonRecord[];
  });

  for (const source of file.currencies ?? []) {
    const code = key(source.currency_code);

    if (!code) continue;

    if (targetCurrencies.some((currency) => key(currency.currency_code) === code)) {
      result.skipped += 1;
      continue;
    }

    try {
      // `is_default` is left out on purpose: this never changes the store's default currency.
      await client.post("/v2/currencies", { body: pick(source, CURRENCY_FIELDS) });
      result.created += 1;
    } catch (error) {
      result.warnings.push(`Currency ${text(source.currency_code)}: ${describe(error)}`);
    }
  }

  // Price lists, found by name or created.
  const targetLists = await readAll(client, "/v3/pricelists").catch(() => [] as JsonRecord[]);
  const listIds = new Map<string, number>();

  for (const list of file.priceLists ?? []) {
    const name = text(list.name);

    if (!name) continue;

    const existing = positiveInt(targetLists.find((candidate) => key(candidate.name) === key(name))?.id);

    if (existing) {
      listIds.set(key(name), existing);
      result.skipped += 1;
      continue;
    }

    try {
      const { data } = await client.post<unknown>("/v3/pricelists", { body: { name, active: list.active !== false } });
      const id = positiveInt(asRecord(asRecord(data)?.data)?.id);

      if (id) listIds.set(key(name), id);

      result.created += 1;
    } catch (error) {
      result.warnings.push(`Price list ${name}: ${describe(error)}`);
    }
  }

  // Records: variants are found by SKU, so a record for a product that isn't in the store yet is skipped.
  const allSkus = (file.priceLists ?? []).flatMap((list) => list.records.map((row) => text(row.sku)));
  const variants = allSkus.length > 0 ? await variantsBySku(client, allSkus).catch((error) => {
    result.warnings.push(`Finding variants: ${describe(error)}`);

    return new Map<string, number>();
  }) : new Map<string, number>();

  for (const list of file.priceLists ?? []) {
    const listId = listIds.get(key(list.name));

    if (!listId) continue;

    const rows: JsonRecord[] = [];
    let missing = 0;

    for (const row of list.records) {
      const variantId = variants.get(text(row.sku));

      if (!variantId) {
        missing += 1;
        continue;
      }

      const { sku: _sku, ...rest } = row;

      rows.push({ variant_id: variantId, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== undefined)) });
    }

    if (missing > 0) result.warnings.push(`${list.name}: ${missing} price records skipped because their SKU isn't in this store. Import the catalog first.`);

    // One bulk upsert at a time: running them in parallel is refused.
    for (let start = 0; start < rows.length; start += CHUNK) {
      try {
        await client.put(`/v3/pricelists/${listId}/records`, { body: rows.slice(start, start + CHUNK) });
        result.updated += Math.min(CHUNK, rows.length - start);
      } catch (error) {
        result.warnings.push(`Prices in ${list.name}: ${describe(error)}`);
      }
    }
  }

  // Assignments: groups and channels are matched by name.
  if ((file.assignments ?? []).length > 0) {
    const groups = await readAll(client, "/v2/customer_groups").catch(() => [] as JsonRecord[]);
    const channels = await readAll(client, "/v3/channels").catch(() => [] as JsonRecord[]);

    for (const assignment of file.assignments) {
      const priceListId = listIds.get(key(assignment.priceList));
      const groupId = assignment.customerGroup ? positiveInt(groups.find((group) => key(group.name) === key(assignment.customerGroup))?.id) : undefined;
      const channelId = assignment.channel ? positiveInt(channels.find((channel) => key(channel.name) === key(assignment.channel))?.id) : undefined;

      if (!priceListId || (assignment.customerGroup && !groupId) || (assignment.channel && !channelId) || (!groupId && !channelId)) {
        result.warnings.push(`Assignment of ${assignment.priceList}${assignment.customerGroup ? ` to ${assignment.customerGroup}` : ""}${assignment.channel ? ` on ${assignment.channel}` : ""} skipped: the customer group or channel isn't in this store.`);
        continue;
      }

      try {
        await client.post("/v3/pricelists/assignments", { body: [{ price_list_id: priceListId, ...(groupId ? { customer_group_id: groupId } : {}), ...(channelId ? { channel_id: channelId } : {}) }] });
        result.created += 1;
      } catch (error) {
        // Already assigned is fine.
        if ((error as { status?: number }).status === 409) result.skipped += 1;
        else result.warnings.push(`Assignment of ${assignment.priceList}: ${describe(error)}`);
      }
    }
  }

  return result;
}

export const pricingLists = (data: PricingData): number => records(data.priceLists).length;
