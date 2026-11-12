// Inventory & locations: the store's inventory settings and its stock locations. Import replaces the
// inventory settings, and adds locations (matched by code, updated when they exist). Stock levels are not
// part of this section: they travel with the products.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { attempt, captureSettings, describe, emptyResult, importSettings, key, pick, positiveInt, readAll, text, type JsonRecord, type SectionFile, type SectionResult, type SettingSpec } from "@/lib/samples/sections/shared";

export interface InventoryData {
  settings: Record<string, JsonRecord>;
  locations: JsonRecord[];
}

const SETTINGS: readonly SettingSpec[] = [{ id: "inventory", label: "Inventory settings", path: "/v3/settings/inventory" }];
const LOCATION_FIELDS = ["code", "label", "description", "type_id", "enabled", "managed_by_external_source", "operating_hours", "time_zone", "address", "storefront_visibility", "special_hours"] as const;

export async function captureInventory(client: BcRestApiClient): Promise<SectionFile<InventoryData>> {
  const { settings, warnings } = await captureSettings(client, SETTINGS);
  const locations = await attempt("Locations", warnings, () => readAll(client, "/v3/inventory/locations"), [] as JsonRecord[]);

  return { data: { settings, locations: locations.map((location) => pick(location, LOCATION_FIELDS)) }, warnings };
}

export async function importInventory(client: BcRestApiClient, file: InventoryData): Promise<SectionResult> {
  const result = await importSettings(client, SETTINGS, file.settings);
  const existing = await readAll(client, "/v3/inventory/locations").catch((error) => {
    result.warnings.push(`Locations: ${describe(error)}`);

    return null;
  });

  if (!existing) return result;

  for (const location of file.locations ?? []) {
    const code = text(location.code);

    if (!code) continue;

    const target = existing.find((candidate) => key(candidate.code) === key(code));
    const targetId = positiveInt(target?.id);

    try {
      if (targetId) await client.put("/v3/inventory/locations", { body: [{ id: targetId, ...location }] });
      else await client.post("/v3/inventory/locations", { body: [location] });

      if (targetId) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      // Plans allow only a few locations, which shows up here.
      result.warnings.push(`Location ${code}: ${describe(error)}`);
    }
  }

  return result;
}
