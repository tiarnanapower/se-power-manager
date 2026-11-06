import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ContentFallback } from "@/components/layout/content-fallback";
import { DEFAULT_PATH } from "@/components/shell/nav-items";
import { getAppUrl } from "@/lib/routing/app-url";

type PageProps = { params: Promise<{ storeHash: string }> };

async function RedirectToDefault({ params }: PageProps): Promise<never> {
  const { storeHash } = await params;

  redirect(getAppUrl(storeHash, `/${DEFAULT_PATH}`));
}

// The app has no home page of its own: opening it lands on the first menu item.
// The redirect sits inside Suspense because it reads the route params.
export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ContentFallback />}>
      <RedirectToDefault params={props.params} />
    </Suspense>
  );
}
