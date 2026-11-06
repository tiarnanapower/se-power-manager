import { SharedCatalogView } from "@/components/shared-catalog/shared-catalog-view";
import { FeaturePage, LoadError } from "@/components/features/ui";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import type { PackSummary } from "@/lib/app-data/types";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

export async function SharedCatalogPage({ params }: PageProps) {
  const raw = (await params).storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let published: PackSummary[] = [];
  let candidates: PackSummary[] = [];
  let failure: string | undefined;

  try {
    const data = getAppDataStore();

    [published, candidates] = await Promise.all([data.listPacks({ published: true }), data.listPacks({ published: false, includeBackups: false })]);
  } catch (error) {
    logError("SharedCatalogPage", error);
    failure = toSafeMessage(error, "Couldn't load the Shared Catalog.");
  }

  return (
    <FeaturePage itemId="shared-catalog">
      {failure ? <LoadError header="Couldn't load the Shared Catalog" text={failure} /> : <SharedCatalogView storeHash={storeHash} published={published} candidates={candidates} />}
    </FeaturePage>
  );
}
