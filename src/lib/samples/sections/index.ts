// The non-catalog sections: how each is captured from a store and imported into one. The catalog has its
// own, richer path (batched, with pictures). Add a section by writing a capture and an import and listing
// it here, then marking it `implemented` in format.ts.
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import type { SampleSectionId } from "@/lib/samples/format";
import { importShipping, captureShipping, type ShippingData } from "@/lib/samples/sections/shipping";
import type { SectionFile, SectionResult } from "@/lib/samples/sections/shared";
import { captureTax, importTax, type TaxData } from "@/lib/samples/sections/tax";

interface SectionModule {
  capture: (client: BcRestApiClient) => Promise<SectionFile>;
  import: (client: BcRestApiClient, data: never) => Promise<SectionResult>;
}

export const SECTION_MODULES: Partial<Record<SampleSectionId, SectionModule>> = {
  shipping: { capture: captureShipping, import: importShipping as SectionModule["import"] },
  tax: { capture: captureTax, import: importTax as SectionModule["import"] },
};

export type { ShippingData, TaxData };

export const isSectionModule = (id: string): id is keyof typeof SECTION_MODULES => id in SECTION_MODULES;
