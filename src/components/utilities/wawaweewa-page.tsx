import { FeaturePage, LoadError, NotConfigured } from "@/components/features/ui";
import { WawaweewaView } from "@/components/utilities/wawaweewa-view";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { getWawaweewaB2bClient, getWawaweewaClient, getWawaweewaStatus, getWawaweewaTokenHint, WAWAWEEWA_VARS } from "@/lib/wawaweewa/config";
import { previewSource, type SourcePreview } from "@/lib/wawaweewa/source";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

export async function WawaweewaPage({ params }: PageProps) {
  const raw = (await params).storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  const status = getWawaweewaStatus();
  let preview: SourcePreview | undefined;
  let failure: string | undefined;

  if (status.configured) {
    try {
      preview = await previewSource(getWawaweewaClient(), getWawaweewaB2bClient());
    } catch (error) {
      logError("WawaweewaPage", error);
      failure = toSafeMessage(error, "Couldn't read the source store.");
    }
  }

  return (
    <FeaturePage itemId="wawaweewa">
      {!status.configured ? <NotConfigured what="The source store" vars={WAWAWEEWA_VARS} /> : failure || !preview ? <LoadError header="Couldn't reach the source store" text={failure ?? "No answer."} /> : <WawaweewaView storeHash={storeHash} preview={preview} sourceLabel={status.label} canWrite={getDataMode() !== "MOCK"} tokenHint={preview.problems.length > 0 ? getWawaweewaTokenHint() : undefined} />}
    </FeaturePage>
  );
}
