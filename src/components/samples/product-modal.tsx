"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/samples/modal";
import { SampleImage } from "@/components/samples/sample-image";
import type { SampleProduct } from "@/lib/samples/format";

interface Props {
  storeHash: string | undefined;
  // Loads the product to show: from a sample in the repo, or from a saved pack.
  load: () => Promise<{ ok: true; product: SampleProduct } | { ok: false; message: string }>;
  // Draws a picture held in the browser (an uploaded snapshot) instead of fetching it from the repo.
  renderImage?: (file: string, className: string) => React.ReactNode;
  onClose: () => void;
}

type Raw = {
  fields?: Record<string, unknown>;
  brandName?: string | null;
  variants?: { sku?: string; price?: number | null; inventory_level?: number | null; option_values?: { option_display_name: string; label: string }[] }[];
  customFields?: { name: string; value: string }[];
  images?: { file?: string; url?: string; isThumbnail: boolean; description: string }[];
  bulkPricingRules?: { quantity_min: number; quantity_max: number; type: string; amount: number }[];
  videos?: { title?: string }[];
  modifiers?: { type?: string; display_name?: string; required?: boolean; option_values?: { label: string; ref?: { sku: string | null; name: string } }[] }[];
  customUrl?: string | null;
};

const plain = (html: string | null) => (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const money = (value: unknown) => (typeof value === "number" ? value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="pp-product__row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ProductModal({ storeHash, load, renderImage, onClose }: Props) {
  const [product, setProduct] = useState<SampleProduct>();
  const [error, setError] = useState<string>();
  const loader = useRef(load);

  useEffect(() => {
    let live = true;

    void loader.current()
      .then((result) => live && (result.ok ? setProduct(result.product) : setError(result.message)))
      .catch(() => live && setError("Couldn't load that product."));

    return () => {
      live = false;
    };
  }, []);

  const raw = (product?.raw ?? {}) as Raw;
  const fields = raw.fields ?? {};

  return (
    <Modal title={product?.name ?? "Product"} onClose={onClose} wide>
      {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
      {!product && !error && <div className="pp-muted">Loading…</div>}
      {product && (
        <div className="pp-product">
          <div className="pp-product__gallery">
            {(raw.images ?? []).length === 0 ? <div className="pp-empty">No images</div> : raw.images?.map((image, i) => (renderImage && image.file ? renderImage(image.file, "pp-product__img") : <SampleImage key={image.file ?? image.url ?? i} file={image.file ?? null} src={image.url || null} storeHash={storeHash} className="pp-product__img" />))}
          </div>
          <dl className="pp-product__facts">
            <Row label="SKU">{product.sku ?? "—"}</Row>
            <Row label="Price">{money(product.price)}</Row>
            {typeof fields.retail_price === "number" && fields.retail_price > 0 && <Row label="Retail price">{money(fields.retail_price)}</Row>}
            {typeof fields.sale_price === "number" && fields.sale_price > 0 && <Row label="Sale price">{money(fields.sale_price)}</Row>}
            {typeof fields.cost_price === "number" && fields.cost_price > 0 && <Row label="Cost">{money(fields.cost_price)}</Row>}
            <Row label="Brand">{raw.brandName ?? "—"}</Row>
            <Row label="Categories">{product.categoryPaths.length ? product.categoryPaths.join(", ") : "—"}</Row>
            <Row label="Stock">{fields.inventory_tracking === "none" || fields.inventory_tracking === undefined ? "Not tracked" : String(fields.inventory_level ?? 0)}</Row>
            <Row label="Visible">{fields.is_visible === false ? "No" : "Yes"}</Row>
            {fields.weight !== undefined && <Row label="Weight">{String(fields.weight)}</Row>}
            {raw.customUrl && <Row label="URL">{raw.customUrl}</Row>}
          </dl>

          {product.description && <section><h3>Description</h3><p className="pp-product__text">{plain(product.description)}</p></section>}

          {(raw.variants ?? []).length > 0 && (
            <section>
              <h3>Variants ({raw.variants?.length})</h3>
              <table className="pp-product__table"><thead><tr><th>SKU</th><th>Options</th><th>Price</th><th>Stock</th></tr></thead>
                <tbody>{raw.variants?.map((variant, i) => <tr key={i}><td>{variant.sku ?? "—"}</td><td>{(variant.option_values ?? []).map((value) => `${value.option_display_name}: ${value.label}`).join(", ")}</td><td>{money(variant.price)}</td><td>{variant.inventory_level ?? "—"}</td></tr>)}</tbody>
              </table>
            </section>
          )}

          {(raw.modifiers ?? []).length > 0 && (
            <section>
              <h3>Options & pick lists ({raw.modifiers?.length})</h3>
              <ul className="pp-product__list">
                {raw.modifiers?.map((modifier, i) => (
                  <li key={i}>
                    <strong>{modifier.display_name}</strong> <span className="pp-pill pp-pill--ended">{(modifier.type ?? "").replace(/_/g, " ")}</span>{modifier.required && <span className="pp-pill pp-pill--exhausted" style={{ marginLeft: 6 }}>required</span>}
                    {(modifier.option_values ?? []).length > 0 && <div className="pp-muted">{modifier.option_values?.map((value) => (value.ref ? `${value.label} → ${value.ref.sku ?? value.ref.name}` : value.label)).join(" · ")}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(raw.customFields ?? []).length > 0 && (
            <section>
              <h3>Custom fields ({raw.customFields?.length})</h3>
              <dl className="pp-product__facts">{raw.customFields?.map((field) => <Row key={field.name} label={field.name}>{field.value}</Row>)}</dl>
            </section>
          )}

          {(raw.bulkPricingRules ?? []).length > 0 && (
            <section>
              <h3>Bulk pricing</h3>
              <ul className="pp-product__list">{raw.bulkPricingRules?.map((rule, i) => <li key={i}>{rule.quantity_min}{rule.quantity_max ? `–${rule.quantity_max}` : "+"} units: {rule.type === "percent" ? `${rule.amount}% off` : rule.type === "fixed" ? `${money(rule.amount)} each` : `${money(rule.amount)} off`}</li>)}</ul>
            </section>
          )}

          {typeof fields.page_title === "string" && fields.page_title && <section><h3>SEO</h3><dl className="pp-product__facts"><Row label="Page title">{fields.page_title}</Row>{typeof fields.meta_description === "string" && <Row label="Description">{fields.meta_description}</Row>}</dl></section>}
        </div>
      )}
    </Modal>
  );
}
