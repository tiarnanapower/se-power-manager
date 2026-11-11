import StorePage from "@/app/store/[storeHash]/catalog/samples/page";

// Root alias for MOCK/STATIC development (no store hash in the URL). The root
// layout renders an Unauthorized page instead when hit in MULTITENANT mode.
export default function Page(props: React.ComponentProps<typeof StorePage>) {
  return <StorePage {...props} />;
}
