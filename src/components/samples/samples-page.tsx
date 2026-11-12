import Link from "next/link";
import { FeaturePage, LoadError } from "@/components/features/ui";
import { SampleImage } from "@/components/samples/sample-image";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { sectionLabel, type SampleIndexEntry } from "@/lib/samples/format";
import { getIndex } from "@/lib/samples/library";
import { getAppUrl } from "@/lib/routing/app-url";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SampleCard({ sample, storeHash }: { sample: SampleIndexEntry; storeHash: string | undefined }) {
  const previews = sample.preview.slice(0, 4);

  return (
    <article className="pp-pack">
      <Link className="pp-pack__link" href={getAppUrl(storeHash, `/catalog/samples/${sample.slug}`)}>
        <div className={`pp-pack__images pp-pack__images--${Math.min(previews.length, 4)}`} aria-hidden="true">
          {previews.length === 0 ? <div className="pp-pack__tile pp-pack__tile--empty">No images</div> : previews.map((file) => <SampleImage key={file} file={file} storeHash={storeHash} />)}
          <span className="pp-pack__badge">{sample.latest}</span>
        </div>
        <div className="pp-pack__body">
          <h3 className="pp-pack__title">{sample.name}</h3>
          <div className="pp-pack__meta">{sample.products} products · {sample.categories} categories</div>
          {sample.description && <p className="pp-pack__desc">{sample.description}</p>}
          <div className="pp-pack__chips">
            {sample.sections.map((id) => <span key={id} className="pp-pill pp-pill--live">{sectionLabel(id)}</span>)}
            {sample.languages.length > 1 && <span className="pp-pill pp-pill--scheduled">{sample.languages.length} languages</span>}
            {sample.tags.map((tag) => <span key={tag} className="pp-pill pp-pill--ended">{tag}</span>)}
          </div>
        </div>
      </Link>
      <div className="pp-pack__actions">
        <Link className="pp-btn pp-btn--primary" href={getAppUrl(storeHash, `/catalog/samples/${sample.slug}`)}>Open</Link>
      </div>
    </article>
  );
}

export async function SamplesPage({ params }: PageProps) {
  const raw = (await params).storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let samples: SampleIndexEntry[] = [];
  let failure: string | undefined;

  try {
    samples = (await getIndex()).samples;
  } catch (error) {
    logError("SamplesPage", error);
    failure = toSafeMessage(error, "Couldn't read the samples repo.");
  }

  return (
    <FeaturePage itemId="store-templates">
      {failure ? (
        <LoadError header="Couldn't load the samples" text={failure} />
      ) : samples.length === 0 ? (
        <section className="pp-card pp-section">
          <h2>No samples yet</h2>
          <p className="pp-section__hint">The samples repo is empty. Capture a store with <code className="pp-code">pnpm samples:capture</code>, commit the result to the repo, and it will appear here.</p>
        </section>
      ) : (
        <div className="pp-pack-grid">{samples.map((sample) => <SampleCard key={sample.slug} sample={sample} storeHash={storeHash} />)}</div>
      )}
    </FeaturePage>
  );
}
