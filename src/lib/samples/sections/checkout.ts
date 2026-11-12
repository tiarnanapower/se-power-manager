// Checkout & customer experience: checkout, cart and abandoned-cart settings, at the store level. Import
// replaces the target's values. Addresses that belong to the source store (the abandoned-cart notification
// email, the order confirmation contact) stay as the target has them, and custom checkout files hosted
// in the source store are dropped, since they don't exist in the target.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { captureSettings, importSettings, text, type JsonRecord, type SectionFile, type SectionResult, type SettingSpec } from "@/lib/samples/sections/shared";
import type { SettingsData } from "@/lib/samples/sections/storefront";

const FILE_FIELDS: [url: string, hash: string][] = [
  ["custom_checkout_script_url", "custom_checkout_sri_hash"],
  ["custom_order_confirmation_script_url", "custom_order_confirmation_sri_hash"],
  ["checkout_style_override", "checkout_style_override_sri_hash"],
];

function prepareCheckout(body: JsonRecord, warnings: string[]): JsonRecord {
  const out = { ...body };

  for (const [url, hash] of FILE_FIELDS) {
    if (text(out[url]).startsWith("webdav:")) {
      warnings.push(`Checkout: ${url} points at a file in the source store, so it was left out.`);
      delete out[url];
      delete out[hash];
    }
  }

  // A custom checkout needs its script; without it the store goes back to the standard one-page checkout.
  if (out.checkout_type === "custom" && !text(out.custom_checkout_script_url)) out.checkout_type = "optimized";

  return out;
}

export const CHECKOUT_SETTINGS: readonly SettingSpec[] = [
  {
    id: "checkout",
    label: "Checkout settings",
    path: "/v3/checkouts/settings",
    skip: ["enhanced_checkout_experience", "support_b2b_settings", "custom_checkout_supports_uco_settings"],
    keep: ["order_confirmation_contact_email"],
    prepare: prepareCheckout,
  },
  { id: "cart", label: "Cart settings", path: "/v3/carts/settings" },
  { id: "abandonedCarts", label: "Abandoned cart settings", path: "/v3/abandoned-carts/settings", keep: ["merchant_email_address"] },
];

export async function captureCheckout(client: BcRestApiClient): Promise<SectionFile<SettingsData>> {
  const { settings, warnings } = await captureSettings(client, CHECKOUT_SETTINGS);

  return { data: { settings }, warnings };
}

export const importCheckout = (client: BcRestApiClient, file: SettingsData): Promise<SectionResult> => importSettings(client, CHECKOUT_SETTINGS, file.settings);
