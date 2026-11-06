import { SharedCatalogView } from "@/components/shared-catalog/shared-catalog-view";
import { FeaturePage, LoadError } from "@/components/features/ui";
import { effectiveStoreHash } from "@/lib/catalog/pack-access";
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

    // Published packs from every store; only this store's own unpublished packs can be offered for publishing.
    [published, candidates] = await Promise.all([data.listPacks({ published: true }), data.listPacks({ published: false, includeBackups: false, ownedBy: effectiveStoreHash(storeHash) })]);
  } catch (error) {
    logError("SharedCatalogPage", error);
    failure = toSafeMessage(error, "Couldn't load the Shared Catalog.");
  }

  return (
    <FeaturePage itemId="shared-catalog">
      {failure ? <LoadError header="Couldn't load the Shared Catalog" text={failure} /> : <SharedCatalogView storeHash={storeHash} ownStoreHash={effectiveStoreHash(storeHash)} published={published} candidates={candidates} />}
    </FeaturePage>
  );
}
