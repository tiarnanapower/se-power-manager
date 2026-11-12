"use client";

import { useEffect, useMemo, useState } from "react";
import { ImportSectionsDialog } from "@/components/samples/import-sections-dialog";
import { uploadSource } from "@/components/samples/import-source";
import { ProductModal } from "@/components/samples/product-modal";
import { SampleImage } from "@/components/samples/sample-image";
import { type BundleSample, openBundle } from "@/lib/samples/bundle";
import { sectionLabel } from "@/lib/samples/format";
import { readDropped, readPicked } from "@/lib/samples/read-files";

const money = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "");

// A picture held in the uploaded files, shown through a temporary address that is released afterwards.
function BundleImage({ sample, file, className }: { sample: BundleSample; file: string | null; className: string }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    const bytes = file ? sample.image(file) : undefined;

    if (!file || !bytes) return;

    const type = file.endsWith("png") ? "image/png" : file.endsWith("webp") ? "image/webp" : file.endsWith("gif") ? "image/gif" : "image/jpeg";
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));

    // The address is an external resource that has to be made and released with the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSrc(url);

    return () => URL.revokeObjectURL(url);
  }, [sample, file]);

  return <SampleImage src={file ? src : null} storeHash={undefined} className={className} />;
}

// Upload a snapshot (a zip or a folder in the Store Templates format), look inside it, then load it into the store.
export function UploadSnapshot({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const [samples, setSamples] = useState<BundleSample[]>([]);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const [notes, setNotes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [openIndex, setOpenIndex] = useState<number>();
  const [importing, setImporting] = useState(false);
  const sample = samples[chosen];

  const load = async (read: () => Promise<Map<string, Uint8Array>>) => {
    setBusy(true);
    setError(undefined);
    setSamples([]);
    setSearch("");

    try {
      const opened = openBundle(await read());

      if (opened.samples.length === 0) throw new Error(opened.problems[0] ?? "That doesn't contain a snapshot. Choose a zip or folder made by Download a snapshot or taken from the templates repo.");

      setSamples(opened.samples);
      setChosen(0);
      setNotes(opened.problems);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't read that.");
    } finally {
      setBusy(false);
    }
  };

  const products = useMemo(() => sample?.catalog?.products ?? [], [sample]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter((product) => !term || product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term));
  }, [products, search]);

  return (
    <>
      <section className="pp-card pp-section">
        <h2>Upload a snapshot</h2>
        <p className="pp-section__hint">Choose a zip, or a folder, made by Download a snapshot (or taken from the templates repo). You can look inside it before anything is loaded into your store.</p>
        <div
          className={`pp-drop${dragging ? " is-over" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void load(() => readDropped(event.dataTransfer)); }}
        >
          <span>{busy ? "Reading…" : "Drop a zip or a folder here, or"}</span>
          <label className="pp-btn">
            Choose a zip
            <input type="file" accept=".zip,application/zip" hidden disabled={busy} onChange={(event) => { const list = event.target.files; if (list?.length) void load(() => readPicked(list)); event.target.value = ""; }} />
          </label>
          <label className="pp-btn">
            Choose a folder
            <input type="file" hidden disabled={busy} {...{ webkitdirectory: "", directory: "" }} onChange={(event) => { const list = event.target.files; if (list?.length) void load(() => readPicked(list)); event.target.value = ""; }} />
          </label>
        </div>
        {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
        {notes.length > 0 && <ul className="pp-errlist">{notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
      </section>

      {sample && (
        <>
          <section className="pp-card pp-section pp-sample__head">
            <div className="pp-sample__title">
              <h2>{sample.name}</h2>
              {sample.description && <p className="pp-section__hint">{sample.description}</p>}
              <div className="pp-pack__chips">
                {Object.keys(sample.manifest.sections).map((id) => <span key={id} className="pp-pill pp-pill--live">{sectionLabel(id)}</span>)}
              </div>
            </div>
            <div className="pp-sample__actions">
              {samples.length > 1 && (
                <label className="pp-field pp-sample__version">Which one
                  <select className="pp-input" value={chosen} onChange={(event) => { setChosen(Number(event.target.value)); setSearch(""); }}>
                    {samples.map((entry, index) => <option key={`${entry.slug}-${entry.version}`} value={index}>{entry.name} · {entry.version}</option>)}
                  </select>
                </label>
              )}
              <button type="button" className="pp-btn pp-btn--primary" onClick={() => setImporting(true)} disabled={!canWrite}>Load into my store</button>
            </div>
            <dl className="pp-sample__stats">
              <div><dt>Products</dt><dd>{products.length}</dd></div>
              <div><dt>Categories</dt><dd>{sample.catalog?.categories.length ?? 0}</dd></div>
              <div><dt>Images</dt><dd>{sample.manifest.images}</dd></div>
              <div><dt>Version</dt><dd>{sample.version}</dd></div>
              <div><dt>Captured</dt><dd>{day(sample.manifest.capturedAt)}</dd></div>
            </dl>
          </section>

          <section className="pp-card pp-section">
            <div className="pp-sample__filters">
              <input className="pp-input" type="search" placeholder="Search name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
              <span className="pp-muted">{shown.length} of {products.length}</span>
            </div>
            {shown.length === 0 ? <div className="pp-empty">No products match.</div> : (
              <div className="pp-sample__products">
                {shown.map((product) => (
                  <button key={product.index} type="button" className="pp-sample__product" onClick={() => setOpenIndex(product.index)}>
                    <BundleImage sample={sample} file={product.image} className="pp-sample__thumb" />
                    <span className="pp-sample__name">{product.name}</span>
                    <span className="pp-muted pp-sample__meta">{product.sku ?? "No SKU"} · {money(product.price)}</span>
                    <span className="pp-sample__badges">
                      {product.variants > 0 && <span className="pp-pill pp-pill--scheduled">{product.variants} variants</span>}
                      {product.modifiers > 0 && <span className="pp-pill pp-pill--live">{product.modifiers} options</span>}
                      {product.customFields > 0 && <span className="pp-pill pp-pill--ended">{product.customFields} fields</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {openIndex !== undefined && (
            <ProductModal
              storeHash={storeHash}
              renderImage={(file, className) => <BundleImage key={file} sample={sample} file={file} className={className} />}
              load={async () => {
                const product = sample.product(openIndex);

                return product ? { ok: true as const, product } : { ok: false as const, message: "That product isn't in the snapshot." };
              }}
              onClose={() => setOpenIndex(undefined)}
            />
          )}
          {importing && <ImportSectionsDialog source={uploadSource(storeHash, sample)} onClose={() => setImporting(false)} />}
        </>
      )}
    </>
  );
}
