import { Suspense } from "react";
import { AuthorizedPage } from "@/components/layout/authorized-page";
import { CalendarPage } from "@/components/calendar/calendar-page";
import { ContentFallback } from "@/components/layout/content-fallback";

type PageProps = Omit<React.ComponentProps<typeof AuthorizedPage>, "pageComponent">;

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ContentFallback />}>
      <AuthorizedPage {...props} pageComponent={CalendarPage} />
    </Suspense>
  );
}
