// Storefront settings: search, SEO, product and category display, robots.txt, security and catalog
// settings, at the store level. Import replaces the target's values with these. The storefront's status
// (open or down for maintenance) and the store profile are deliberately not copied.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { captureSettings, importSettings, type JsonRecord, type SectionFile, type SectionResult, type SettingSpec } from "@/lib/samples/sections/shared";

export interface SettingsData {
  settings: Record<string, JsonRecord>;
}

export const STOREFRONT_SETTINGS: readonly SettingSpec[] = [
  { id: "search", label: "Search settings", path: "/v3/settings/storefront/search" },
  { id: "seo", label: "SEO settings", path: "/v3/settings/storefront/seo" },
  { id: "product", label: "Product display settings", path: "/v3/settings/storefront/product" },
  { id: "category", label: "Category settings", path: "/v3/settings/storefront/category" },
  { id: "robots", label: "Robots.txt", path: "/v3/settings/storefront/robotstxt" },
  { id: "security", label: "Security settings", path: "/v3/settings/storefront/security" },
  { id: "catalog", label: "Catalog settings", path: "/v3/settings/catalog" },
];

export async function captureStorefront(client: BcRestApiClient): Promise<SectionFile<SettingsData>> {
  const { settings, warnings } = await captureSettings(client, STOREFRONT_SETTINGS);

  return { data: { settings }, warnings };
}

export const importStorefront = (client: BcRestApiClient, file: SettingsData): Promise<SectionResult> => importSettings(client, STOREFRONT_SETTINGS, file.settings);
