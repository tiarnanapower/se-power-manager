import { FeaturePage, LoadError } from "@/components/features/ui";
import { PersonalDetailView, type PackProductSummary } from "@/components/personal/personal-detail-view";
import type { PackSummary } from "@/lib/app-data/types";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import { effectiveStoreHash, ownsPack } from "@/lib/catalog/pack-access";
import type { PackProductRaw } from "@/lib/catalog/pack-mapper";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function PersonalDetailPage({ params }: PageProps) {
  const { storeHash: rawStore, id: rawId } = await params;
  const storeHash = first(rawStore);
  const id = first(rawId) ?? "";
  let pack: PackSummary | undefined;
  let products: PackProductSummary[] = [];
  let failure: string | undefined;

  try {
    const full = await getAppDataStore().getPack(id);

    // A pack that isn't this store's is reported as missing, so its existence isn't revealed.
    if (!full || !ownsPack(full, effectiveStoreHash(storeHash))) throw new Error("That pack no longer exists.");

    const { products: all, ...summary } = full;

    pack = summary;
    products = all.map((product, index): PackProductSummary => {
      const raw = product.raw as unknown as Partial<PackProductRaw>;
      const image = raw.images?.[0]?.url || product.imageUrls[0] || null;

      return { index, name: product.name, sku: product.sku, price: product.price, image, categories: product.categoryPaths, variants: raw.variants?.length ?? 0, modifiers: raw.modifiers?.length ?? 0, customFields: raw.customFields?.length ?? 0 };
    });
  } catch (error) {
    logError("PersonalDetailPage", error);
    failure = toSafeMessage(error, "Couldn't load that pack.");
  }

  return (
    <FeaturePage itemId="my-snapshots">
      {failure || !pack ? <LoadError header="Couldn't load the pack" text={failure ?? "That pack no longer exists."} /> : <PersonalDetailView storeHash={storeHash} pack={pack} products={products} />}
    </FeaturePage>
  );
}
