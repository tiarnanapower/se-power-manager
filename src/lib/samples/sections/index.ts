// The non-catalog sections: how each is captured from a store and imported into one. The catalog has its
// own, richer path (batched, with pictures). Add a section by writing a capture and an import and listing
// it here, then marking it `implemented` in format.ts.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import type { SampleSectionId } from "@/lib/samples/format";
import { captureB2b, importB2b, type B2bData } from "@/lib/samples/sections/b2b";
import { captureCheckout, importCheckout } from "@/lib/samples/sections/checkout";
import { captureInventory, importInventory, type InventoryData } from "@/lib/samples/sections/inventory";
import { captureLocalization, importLocalization, type LocalizationData } from "@/lib/samples/sections/localization";
import { capturePricing, importPricing, type PricingData } from "@/lib/samples/sections/pricing";
import { importShipping, captureShipping, type ShippingData } from "@/lib/samples/sections/shipping";
import type { SectionExtras, SectionFile, SectionResult } from "@/lib/samples/sections/shared";
import { captureStorefront, importStorefront, type SettingsData } from "@/lib/samples/sections/storefront";
import { captureTax, importTax, type TaxData } from "@/lib/samples/sections/tax";

export interface SectionModule {
  capture: (client: BcRestApiClient, extras?: SectionExtras) => Promise<SectionFile>;
  import: (client: BcRestApiClient, data: never, extras?: SectionExtras) => Promise<SectionResult>;
}

export const SECTION_MODULES: Partial<Record<SampleSectionId, SectionModule>> = {
  shipping: { capture: captureShipping, import: importShipping as SectionModule["import"] },
  tax: { capture: captureTax, import: importTax as SectionModule["import"] },
  pricing: { capture: capturePricing, import: importPricing as SectionModule["import"] },
  storefront: { capture: captureStorefront, import: importStorefront as SectionModule["import"] },
  checkout: { capture: captureCheckout, import: importCheckout as SectionModule["import"] },
  inventory: { capture: captureInventory, import: importInventory as SectionModule["import"] },
  localization: { capture: captureLocalization, import: importLocalization as SectionModule["import"] },
  b2b: { capture: captureB2b, import: importB2b as SectionModule["import"] },
};

export type { B2bData, InventoryData, LocalizationData, PricingData, SettingsData, ShippingData, TaxData };

export const isSectionModule = (id: string): id is keyof typeof SECTION_MODULES => id in SECTION_MODULES;
