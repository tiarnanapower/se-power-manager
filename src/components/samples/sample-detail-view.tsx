"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ImportSectionsDialog } from "@/components/samples/import-sections-dialog";
import { ProductModal } from "@/components/samples/product-modal";
import { SampleImage } from "@/components/samples/sample-image";
import { sectionLabel } from "@/lib/samples/format";
import type { CommitInfo } from "@/lib/samples/github";
import type { VersionBundle } from "@/lib/samples/library";
import { getAppUrl } from "@/lib/routing/app-url";

interface Props {
  storeHash: string | undefined;
  bundle: VersionBundle;
  history: CommitInfo[];
  historyNote?: string;
  canImport: boolean;
}

type Tab = "products" | "categories" | "versions";

const money = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "");

export function SampleDetailView({ storeHash, bundle, history, historyNote, canImport }: Props) {
  const { meta, version, manifest, catalog } = bundle;
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [openIndex, setOpenIndex] = useState<number>();
  const [importing, setImporting] = useState(false);
  const products = useMemo(() => catalog?.products ?? [], [catalog]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter((product) => (!term || product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term)) && (!category || product.categories.some((path) => path === category || path.startsWith(`${category} > `))));
  }, [products, search, category]);
  const sections = Object.keys(manifest.sections);

  return (
    <>
      <section className="pp-card pp-section pp-sample__head">
        <div className="pp-sample__title">
          <Link className="pp-sample__back" href={getAppUrl(storeHash, "/catalog/samples")}>← Sample Catalog</Link>
          <h2>{meta.name}</h2>
          {meta.description && <p className="pp-section__hint">{meta.description}</p>}
          <div className="pp-pack__chips">
            {sections.map((id) => <span key={id} className="pp-pill pp-pill--live">{sectionLabel(id)}</span>)}
            {meta.tags.map((tag) => <span key={tag} className="pp-pill pp-pill--ended">{tag}</span>)}
          </div>
        </div>
        <div className="pp-sample__actions">
          <label className="pp-field pp-sample__version">Version
            <select className="pp-input" value={version} onChange={(event) => { window.location.assign(getAppUrl(storeHash, `/catalog/samples/${meta.slug}?v=${event.target.value}`)); }}>
              {[...meta.versions].reverse().map((entry) => <option key={entry.version} value={entry.version}>{entry.version}{entry.version === meta.latest ? " (latest)" : ""} · {day(entry.date)}</option>)}
            </select>
          </label>
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => setImporting(true)} disabled={!canImport}>Import this sample</button>
        </div>
        <dl className="pp-sample__stats">
          <div><dt>Products</dt><dd>{products.length}</dd></div>
          <div><dt>Categories</dt><dd>{catalog?.categories.length ?? 0}</dd></div>
          <div><dt>Images</dt><dd>{manifest.images}</dd></div>
          <div><dt>Language</dt><dd>{meta.defaultLanguage.toUpperCase()}{meta.languages.length > 1 ? ` +${meta.languages.length - 1}` : ""}</dd></div>
          <div><dt>Captured</dt><dd>{day(manifest.capturedAt)}</dd></div>
        </dl>
      </section>

      <div className="pp-tabs" role="tablist">
        {([["products", `Products (${products.length})`], ["categories", `Categories (${catalog?.categories.length ?? 0})`], ["versions", "Versions & history"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="pp-tabs__tab" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "products" && (
        <section className="pp-card pp-section">
          {!catalog ? <div className="pp-empty">This version has no catalog.</div> : (
            <>
              <div className="pp-sample__filters">
                <input className="pp-input" type="search" placeholder="Search name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
                <select className="pp-input" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
                  <option value="">All categories</option>
                  {catalog.categories.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
                </select>
                <span className="pp-muted">{shown.length} of {products.length}</span>
              </div>
              {shown.length === 0 ? <div className="pp-empty">No products match.</div> : (
                <div className="pp-sample__products">
                  {shown.map((product) => (
                    <button key={product.index} type="button" className="pp-sample__product" onClick={() => setOpenIndex(product.index)}>
                      <SampleImage file={product.image} storeHash={storeHash} className="pp-sample__thumb" />
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
            </>
          )}
        </section>
      )}

      {tab === "categories" && (
        <section className="pp-card pp-section">
          {!catalog || catalog.categories.length === 0 ? <div className="pp-empty">No categories.</div> : (
            <ul className="pp-sample__tree">
              {catalog.categories.map((entry) => {
                const depth = entry.path.split(" > ").length - 1;
                const count = products.filter((product) => product.categories.some((path) => path === entry.path || path.startsWith(`${entry.path} > `))).length;

                return <li key={entry.path} style={{ paddingLeft: depth * 22 }}><button type="button" className="pp-sample__cat" onClick={() => { setCategory(entry.path); setTab("products"); }}>{entry.path.split(" > ").pop()}</button><span className="pp-muted"> {count}</span></li>;
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "versions" && (
        <>
          <section className="pp-card pp-section">
            <h2>Versions</h2>
            <p className="pp-section__hint">Each version is a snapshot that never changes. Pick the one you want to import; older versions stay available.</p>
            <ul className="pp-sample__versions">
              {[...meta.versions].reverse().map((entry) => (
                <li key={entry.version} className={entry.version === version ? "is-current" : ""}>
                  <div>
                    <strong>{entry.version}</strong>{entry.version === meta.latest && <span className="pp-pill pp-pill--live" style={{ marginLeft: 8 }}>latest</span>}
                    <div className="pp-muted">{day(entry.date)} · {entry.products} products · {entry.sections.map(sectionLabel).join(", ")}</div>
                    {entry.notes && <div>{entry.notes}</div>}
                  </div>
                  {entry.version !== version && <Link className="pp-btn" href={getAppUrl(storeHash, `/catalog/samples/${meta.slug}?v=${entry.version}`)}>View</Link>}
                </li>
              ))}
            </ul>
          </section>
          <section className="pp-card pp-section">
            <h2>Change history</h2>
            <p className="pp-section__hint">Every commit to this sample in GitHub, newest first.</p>
            {historyNote && <div className="pp-warn">{historyNote}</div>}
            {history.length === 0 ? <div className="pp-empty">No history to show.</div> : (
              <ul className="pp-sample__versions">
                {history.map((commit) => (
                  <li key={commit.sha}>
                    <div><strong>{commit.message}</strong><div className="pp-muted">{commit.author} · {day(commit.date)}</div></div>
                    <a className="pp-btn" href={commit.url} target="_blank" rel="noreferrer">{commit.sha}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {openIndex !== undefined && <ProductModal storeHash={storeHash} slug={meta.slug} version={version} index={openIndex} onClose={() => setOpenIndex(undefined)} />}
      {importing && <ImportSectionsDialog storeHash={storeHash} productCount={products.length} slug={meta.slug} name={meta.name} version={version} manifest={manifest} languages={meta.languages} defaultLanguage={meta.defaultLanguage} onClose={() => setImporting(false)} />}
    </>
  );
}
