import { FeaturePage } from "@/components/features/ui";
import { HealthView } from "@/components/health/health-view";
import { getDataMode } from "@/lib/bc-api-client/data-mode";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function HealthPage({ params }: PageProps) {
  const raw = (await params).storeHash;

  return (
    <FeaturePage itemId="store-health">
      <HealthView storeHash={Array.isArray(raw) ? raw[0] : raw} canScan={getDataMode() !== "MOCK"} />
    </FeaturePage>
  );
}
