// Clearing the non-catalog sections. Each section lists what it can remove as small steps, and a call
// removes some of them, so a big store is cleared across several short requests. Settings sections
// (storefront, checkout, localization) are not here: they can only be replaced, never deleted.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { first, readB2b } from "@/lib/samples/sections/b2b";
import { describe, positiveInt, readAll, text, type JsonRecord, type SectionExtras } from "@/lib/samples/sections/shared";

export const CLEARABLE_SECTIONS = ["b2b", "pricing", "shipping", "tax", "inventory"] as const;
export type ClearableSection = (typeof CLEARABLE_SECTIONS)[number];

export const isClearable = (id: string): id is ClearableSection => (CLEARABLE_SECTIONS as readonly string[]).includes(id);

export const CLEAR_REASONS: Record<string, string> = {
  storefront: "These are settings. They can only be replaced by importing, not deleted.",
  checkout: "These are settings. They can only be replaced by importing, not deleted.",
  localization: "Languages and translations can only be replaced by importing, not deleted.",
};

interface Item { label: string; remove: () => Promise<unknown> }

export interface ClearPreviewItem { count: number; sample: string[] }
export interface ClearStep { deleted: number; remaining: number; warnings: string[] }


async function listItems(client: BcRestApiClient, section: ClearableSection, extras: SectionExtras): Promise<Item[]> {
  switch (section) {
    case "shipping": {
      const items: Item[] = [];

      for (const zone of await readAll(client, "/v2/shipping/zones")) {
        const id = positiveInt(zone.id);
        const label = `Shipping zone ${text(zone.name) || id}`;

        if (!id) continue;

        // The default "rest of world" zone can't be deleted, so only its methods go.
        const methods = await readAll(client, `/v2/shipping/zones/${id}/methods`).catch(() => [] as JsonRecord[]);
        const global = text(zone.type) === "global";

        if (global && methods.length === 0) continue;

        items.push({
          label,
          remove: async () => {
            for (const method of methods) await client.delete(`/v2/shipping/zones/${id}/methods/${text(String(method.id))}`);

            if (!global) await client.delete(`/v2/shipping/zones/${id}`);
          },
        });
      }

      return items;
    }

    case "tax": {
      const rates = await readAll(client, "/v3/tax/rates").catch(() => [] as JsonRecord[]);
      const zones = await readAll(client, "/v3/tax/zones").catch(() => [] as JsonRecord[]);
      const classes = await readAll(client, "/v2/tax_classes").catch(() => [] as JsonRecord[]);

      return [
        ...rates.flatMap((row): Item[] => { const id = positiveInt(row.id); return id ? [{ label: `Tax rate ${text(row.name) || id}`, remove: () => client.delete(`/v3/tax/rates?id:in=${id}`) }] : []; }),
        ...zones.flatMap((row): Item[] => { const id = positiveInt(row.id); return id ? [{ label: `Tax zone ${text(row.name) || id}`, remove: () => client.delete(`/v3/tax/zones?id:in=${id}`) }] : []; }),
        ...classes.flatMap((row): Item[] => { const id = positiveInt(row.id); return id && text(row.name) !== "Default Tax Class" ? [{ label: `Tax class ${text(row.name)}`, remove: () => client.delete(`/v2/tax_classes/${id}`) }] : []; }),
      ];
    }

    case "pricing": {
      const lists = await readAll(client, "/v3/pricelists").catch(() => [] as JsonRecord[]);
      const currencies = await readAll(client, "/v2/currencies").catch(() => [] as JsonRecord[]);

      return [
        // Deleting a price list also deletes its prices and its assignments.
        ...lists.flatMap((row): Item[] => { const id = positiveInt(row.id); return id ? [{ label: `Price list ${text(row.name) || id}`, remove: () => client.delete(`/v3/pricelists/${id}`) }] : []; }),
        // The store's default currency can never be removed.
        ...currencies.flatMap((row): Item[] => { const id = positiveInt(row.id); return id && row.is_default !== true ? [{ label: `Currency ${text(row.currency_code) || id}`, remove: () => client.delete(`/v2/currencies/${id}`) }] : []; }),
      ];
    }

    case "inventory": {
      const locations = await readAll(client, "/v3/inventory/locations").catch(() => [] as JsonRecord[]);

      return locations.flatMap((row): Item[] => { const id = positiveInt(row.id); return id ? [{ label: `Location ${text(row.label) || text(row.code) || id}`, remove: () => client.delete(`/v3/inventory/locations?location_id:in=${id}`) }] : []; });
    }

    case "b2b": {
      if (!extras.b2b) throw new Error("B2B Edition isn't available for this store.");

      const b2b = await extras.b2b();
      const companies = await readB2b(b2b, "/companies");
      const roles = await readB2b(b2b, "/companies/roles").catch(() => [] as JsonRecord[]);

      return [
        ...companies.flatMap((row): Item[] => { const id = positiveInt(row.companyId ?? row.id); return id ? [{ label: `Company ${first(row, "companyName", "name") || id}`, remove: () => b2b.delete(`/companies/${id}`) }] : []; }),
        // Only custom roles can be deleted. They go after the companies that may use them.
        ...roles.flatMap((row): Item[] => { const id = positiveInt(row.id); return id && Number(row.roleType) === 2 ? [{ label: `Role ${first(row, "name") || id}`, remove: () => b2b.delete(`/companies/roles/${id}`) }] : []; }),
      ];
    }
  }
}

export async function previewClearSection(client: BcRestApiClient, section: ClearableSection, extras: SectionExtras = {}): Promise<ClearPreviewItem> {
  const items = await listItems(client, section, extras);

  return { count: items.length, sample: items.slice(0, 3).map((item) => item.label) };
}

// Removes up to `limit` items. `remaining` is how many are still there after this step, so the caller
// repeats until it reaches 0, or until a step removes nothing (the rest can't be deleted).
export async function clearSectionStep(client: BcRestApiClient, section: ClearableSection, extras: SectionExtras = {}, limit = 10): Promise<ClearStep> {
  const items = await listItems(client, section, extras);
  const warnings: string[] = [];
  let deleted = 0;

  for (const item of items.slice(0, limit)) {
    try {
      await item.remove();
      deleted += 1;
    } catch (error) {
      warnings.push(`${item.label}: ${describe(error)}`);
    }
  }

  return { deleted, remaining: Math.max(0, items.length - deleted), warnings };
}

