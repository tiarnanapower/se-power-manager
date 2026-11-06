import { RestoreView } from "@/components/restore/restore-view";
import { FeaturePage, LoadError } from "@/components/features/ui";
import { blobImageStore } from "@/lib/catalog/image-store";
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
  let failure: string | undefined;

  try {
    packs = await getAppDataStore().listPacks();
  } catch (error) {
    logError("RestorePage", error);
    failure = toSafeMessage(error, "Couldn't load the pack library.");
  }

  return (
    <FeaturePage itemId="restore">
      {failure ? <LoadError header="Couldn't load packs" text={failure} /> : <RestoreView storeHash={storeHash} packs={packs} canWrite={getDataMode() !== "MOCK"} imageStorage={blobImageStore.configured()} initialPackId={packs.some((pack) => pack.id === requestedPack) ? requestedPack : undefined} />}
    </FeaturePage>
  );
}
