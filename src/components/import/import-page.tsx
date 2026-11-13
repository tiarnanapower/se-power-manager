import { FeaturePage } from "@/components/features/ui";
import { ImportTabs } from "@/components/import/import-tabs";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { isAiConfigured } from "@/lib/ai/portkey";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function ImportPage({ params }: PageProps) {
  const raw = (await params).storeHash;

  return (
    <FeaturePage itemId="import">
      <ImportTabs storeHash={Array.isArray(raw) ? raw[0] : raw} aiConfigured={isAiConfigured()} canWrite={getDataMode() !== "MOCK"} />
    </FeaturePage>
  );
}
