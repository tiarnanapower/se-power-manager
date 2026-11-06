"use client";

import { useState } from "react";
import { BoxIcon } from "@/components/shell/icons";
import type { PackSummary } from "@/lib/app-data/types";

interface Props {
  pack: PackSummary;
  // Small label in the corner of the images, e.g. "Backup" or "Shared".
  badge?: string;
  // "Added by Alex" style line under the title.
  byline?: string;
  actions?: React.ReactNode;
}

const IMAGES_LABEL = {
  preserved: "Images saved",
  pending: "Saving images…",
  partial: "Some images missing",
  skipped: "Images not saved (links only)",
} as const;

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// One tile of the image mosaic. An image that fails to load (the source
// product was deleted, or the URL expired) falls back to a plain tile rather
// than a broken-image icon.
function Tile({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="pp-pack__tile">
      {failed ? (
        <BoxIcon size={22} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- remote product images from any store CDN; next/image would need every host allow-listed.
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export function PackCard({ pack, badge, byline, actions }: Props) {
  const { images, categories, names } = pack.preview;
  const more = pack.productCount - names.length;

  return (
    <article className="pp-pack">
      <div className={`pp-pack__images pp-pack__images--${Math.min(images.length, 4)}`} aria-hidden="true">
        {images.length === 0 ? (
          <div className="pp-pack__tile pp-pack__tile--empty"><BoxIcon size={28} /><span>No images</span></div>
        ) : (
          images.slice(0, 4).map((src) => <Tile key={src} src={src} />)
        )}
        {badge && <span className="pp-pack__badge">{badge}</span>}
      </div>
      <div className="pp-pack__body">
        <h3 className="pp-pack__title">{pack.name}</h3>
        <div className="pp-pack__meta">
          {pack.productCount} product{pack.productCount === 1 ? "" : "s"}
          {byline ? ` · ${byline}` : ""} · {day(pack.publishedAt ?? pack.createdAt)}
        </div>
        <div className={`pp-pack__images-state pp-pack__images-state--${pack.imagesState}`}>{IMAGES_LABEL[pack.imagesState]}</div>
        {pack.description && <p className="pp-pack__desc">{pack.description}</p>}
        {categories.length > 0 && <div className="pp-pack__chips">{categories.map((name) => <span key={name} className="pp-chip-static">{name}</span>)}</div>}
        {names.length > 0 && <div className="pp-pack__names">{names.join(", ")}{more > 0 ? ` +${more} more` : ""}</div>}
      </div>
      {actions && <div className="pp-pack__actions">{actions}</div>}
    </article>
  );
}

export function PackGrid({ children }: { children: React.ReactNode }) {
  return <div className="pp-pack-grid">{children}</div>;
}
