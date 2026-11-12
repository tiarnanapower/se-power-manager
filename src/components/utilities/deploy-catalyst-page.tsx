import { FeaturePage } from "@/components/features/ui";
import { DeployCatalystView } from "@/components/utilities/deploy-catalyst-view";

export async function DeployCatalystPage() {
  return (
    <FeaturePage itemId="deploy-catalyst">
      <DeployCatalystView />
    </FeaturePage>
  );
}
