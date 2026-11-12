import { Suspense } from "react";
import { AuthorizedPage } from "@/components/layout/authorized-page";
import { WawaweewaSpinner } from "@/components/utilities/wawaweewa-spinner";
import { WawaweewaPage } from "@/components/utilities/wawaweewa-page";

type PageProps = Omit<React.ComponentProps<typeof AuthorizedPage>, "pageComponent">;

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<WawaweewaSpinner label="Reading the source store" />}>
      <AuthorizedPage {...props} pageComponent={WawaweewaPage} />
    </Suspense>
  );
}
