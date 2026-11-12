import StorePage from "@/app/store/[storeHash]/utilities/wawaweewa/page";

// Root alias for MOCK/STATIC development (no store hash in the URL).
export default function Page(props: React.ComponentProps<typeof StorePage>) {
  return <StorePage {...props} />;
}
