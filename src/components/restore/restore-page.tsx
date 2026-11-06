import { RestoreView } from "@/components/restore/restore-view";
import { FeaturePage, LoadError } from "@/components/features/ui";
import { blobImageStore } from "@/lib/catalog/image-store";
import { effectiveStoreHash } from "@/lib/catalog/pack-access";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import type { PackSummary } from "@/lib/app-data/types";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function RestorePage({ params, searchParams }: PageProps) {
  const raw = (await params).storeHash;
  const rawPack = (await searchParams).pack;
  const requestedPack = Array.isArray(rawPack) ? rawPack[0] : rawPack;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let packs: PackSummary[] = [];
  let sharedPacks: PackSummary[] = [];
  let failure: string | undefined;

  try {
    const data = getAppDataStore();
    const owner = effectiveStoreHash(storeHash);

    // This store's own packs, and packs other stores have published (restorable, not editable).
    packs = await data.listPacks({ ownedBy: owner });
    sharedPacks = (await data.listPacks({ published: true })).filter((pack) => pack.storeHash !== owner);
  } catch (error) {
    logError("RestorePage", error);
    failure = toSafeMessage(error, "Couldn't load the pack library.");
  }

  return (
    <FeaturePage itemId="restore">
      {failure ? <LoadError header="Couldn't load packs" text={failure} /> : <RestoreView storeHash={storeHash} packs={packs} sharedPacks={sharedPacks} canWrite={getDataMode() !== "MOCK"} imageStorage={blobImageStore.configured()} initialPackId={[...packs, ...sharedPacks].some((pack) => pack.id === requestedPack) ? requestedPack : undefined} />}
    </FeaturePage>
  );
}
