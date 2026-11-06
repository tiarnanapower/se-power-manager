import { Suspense } from "react";
import { AuthorizedPage } from "@/components/layout/authorized-page";
import { ContentFallback } from "@/components/layout/content-fallback";
import { EnrichPage } from "@/components/features/feature-pages";

type PageProps = Omit<React.ComponentProps<typeof AuthorizedPage>, "pageComponent">;

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ContentFallback />}>
      <AuthorizedPage {...props} pageComponent={EnrichPage} />
    </Suspense>
  );
}
