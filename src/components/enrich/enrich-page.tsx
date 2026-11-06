import "@/app/enrich.css";
import { EnrichProvider } from "@/components/enrich/api";
import { Workspace } from "@/components/enrich/Workspace";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function EnrichPage({ params }: PageProps) {
  const raw = (await params).storeHash;

  return (
    <div className="enrich-root">
      <EnrichProvider storeHash={Array.isArray(raw) ? raw[0] : raw}>
        <Workspace />
      </EnrichProvider>
    </div>
  );
}
