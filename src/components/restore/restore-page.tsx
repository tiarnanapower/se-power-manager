import { RestoreView } from "@/components/restore/restore-view";
import { FeaturePage, LoadError } from "@/components/features/ui";
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

export async function RestorePage({ params }: PageProps) {
  const raw = (await params).storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let packs: PackSummary[] = [];
  let failure: string | undefined;

  try {
    const data = getAppDataStore();

    // Packs are private to the store that saved them.
    packs = await data.listPacks({ ownedBy: effectiveStoreHash(storeHash) });
  } catch (error) {
    logError("RestorePage", error);
    failure = toSafeMessage(error, "Couldn't load the pack library.");
  }

  return (
    <FeaturePage itemId="my-snapshots">
      {failure ? <LoadError header="Couldn't load packs" text={failure} /> : <RestoreView storeHash={storeHash} packs={packs} canWrite={getDataMode() !== "MOCK"} />}
    </FeaturePage>
  );
}
