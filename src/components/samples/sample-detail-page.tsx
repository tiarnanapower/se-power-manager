import { FeaturePage, LoadError } from "@/components/features/ui";
import { SampleDetailView } from "@/components/samples/sample-detail-view";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { isSlug, isVersion } from "@/lib/samples/format";
import type { CommitInfo } from "@/lib/samples/github";
import { getHistory, getVersion, type VersionBundle } from "@/lib/samples/library";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function SampleDetailPage({ params, searchParams }: PageProps) {
  const { storeHash: rawStore, slug: rawSlug } = await params;
  const storeHash = first(rawStore);
  const slug = first(rawSlug);
  const requested = first((await searchParams).v);
  let bundle: VersionBundle | undefined;
  let history: CommitInfo[] = [];
  let historyNote: string | undefined;
  let failure: string | undefined;

  try {
    if (!isSlug(slug)) throw new Error("Unknown sample.");

    bundle = await getVersion(slug, isVersion(requested) ? requested : undefined);
    history = await getHistory(slug).catch((error) => {
      logError("SampleDetailPage: history", error);
      historyNote = "GitHub's change history couldn't be loaded. The version list below is still accurate.";

      return [];
    });
  } catch (error) {
    logError("SampleDetailPage", error);
    failure = toSafeMessage(error, "Couldn't load that sample.");
  }

  return (
    <FeaturePage itemId="demo-snapshots">
      {failure || !bundle ? <LoadError header="Couldn't load the sample" text={failure ?? "Unknown sample."} /> : <SampleDetailView storeHash={storeHash} bundle={bundle} history={history} historyNote={historyNote} canImport={getDataMode() !== "MOCK"} />}
    </FeaturePage>
  );
}
