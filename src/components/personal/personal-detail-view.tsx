"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getPackProductAction } from "@/app/store/[storeHash]/catalog/personal/actions";
import { RestorePackDialog } from "@/components/personal/restore-pack-dialog";
import { ProductModal } from "@/components/samples/product-modal";
import { SampleImage } from "@/components/samples/sample-image";
import type { PackSummary } from "@/lib/app-data/types";
import { getAppUrl } from "@/lib/routing/app-url";

export interface PackProductSummary {
  index: number;
  name: string;
  sku: string | null;
  price: number | null;
  image: string | null;
  categories: string[];
  variants: number;
  modifiers: number;
  customFields: number;
}

const money = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const IMAGES: Record<PackSummary["imagesState"], string> = { preserved: "Images saved", pending: "Images being saved", partial: "Some images missing", skipped: "Images not saved (links only)" };

export function PersonalDetailView({ storeHash, pack, products, canWrite, imageStorage }: { storeHash: string | undefined; pack: PackSummary; products: PackProductSummary[]; canWrite: boolean; imageStorage: boolean }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [openIndex, setOpenIndex] = useState<number>();
  const [restoring, setRestoring] = useState(false);
  const categories = useMemo(() => [...new Set(products.flatMap((product) => product.categories))].sort(), [products]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter((product) => (!term || product.name.toLowerCase().includes(term) || (product.sku ?? "").toLowerCase().includes(term)) && (!category || product.categories.includes(category)));
  }, [products, search, category]);

  return (
    <>
      <section className="pp-card pp-section pp-sample__head">
        <div className="pp-sample__title">
          <Link className="pp-sample__back" href={getAppUrl(storeHash, "/catalog/personal")}>← Personal Catalog</Link>
          <h2>{pack.name}</h2>
          {pack.description && <p className="pp-section__hint">{pack.description}</p>}
          <div className="pp-pack__chips">
            <span className="pp-pill pp-pill--live">Catalog</span>
            {pack.source === "backup" && <span className="pp-pill pp-pill--exhausted">Backup before a clear</span>}
            {pack.source === "scrape" && <span className="pp-pill pp-pill--scheduled">From the Import Tool</span>}
          </div>
        </div>
        <div className="pp-sample__actions">
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => setRestoring(true)} disabled={!canWrite}>Restore this pack</button>
        </div>
        <dl className="pp-sample__stats">
          <div><dt>Products</dt><dd>{pack.productCount}</dd></div>
          <div><dt>Categories</dt><dd>{categories.length}</dd></div>
          <div><dt>Images</dt><dd style={{ fontSize: 14 }}>{IMAGES[pack.imagesState]}</dd></div>
          <div><dt>Saved</dt><dd>{day(pack.createdAt)}</dd></div>
          <div><dt>By</dt><dd style={{ fontSize: 14, overflowWrap: "anywhere" }}>{pack.createdByEmail ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="pp-card pp-section">
        <div className="pp-sample__filters">
          <input className="pp-input" type="search" placeholder="Search name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search products" />
          <select className="pp-input" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <span className="pp-muted">{shown.length} of {products.length}</span>
        </div>
        {shown.length === 0 ? <div className="pp-empty">No products match.</div> : (
          <div className="pp-sample__products">
            {shown.map((product) => (
              <button key={product.index} type="button" className="pp-sample__product" onClick={() => setOpenIndex(product.index)}>
                <SampleImage src={product.image} storeHash={storeHash} className="pp-sample__thumb" />
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

      {openIndex !== undefined && <ProductModal storeHash={storeHash} load={() => getPackProductAction(storeHash, { packId: pack.id, index: openIndex })} onClose={() => setOpenIndex(undefined)} />}
      {restoring && <RestorePackDialog storeHash={storeHash} pack={pack} imageStorage={imageStorage} onClose={() => setRestoring(false)} />}
    </>
  );
}
