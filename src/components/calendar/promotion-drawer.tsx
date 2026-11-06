"use client";

import { useState } from "react";
import { StorefrontPreview } from "@/components/calendar/storefront-preview";
import { StatePill } from "@/components/calendar/state-pill";
import { ChevronRightIcon, CloseIcon } from "@/components/shell/icons";
import { describeAudience } from "@/lib/promo-calendar/audience-filter";
import { formatRange } from "@/lib/promo-calendar/dates";
import type { CalendarPromotion, Conflict } from "@/lib/promo-calendar/types";

interface DrawerProps {
  promotion: CalendarPromotion;
  conflicts: Conflict[];
  allPromotions: Map<number, CalendarPromotion>;
  groupNames: Map<number, string>;
  channelNames: Map<number, string>;
  timeZone?: string;
  currencySymbol?: string;
  segmentNames?: Map<string, string>;
  onClose(): void;
  onSelect(id: number): void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pp-kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PromotionDrawer({ promotion, conflicts, allPromotions, groupNames, channelNames, timeZone = "UTC", currencySymbol = "", segmentNames, onClose, onSelect }: DrawerProps) {
  const [tab, setTab] = useState<"details" | "preview">("details");
  const channels = promotion.channelIds.length === 0 ? "All channels" : promotion.channelIds.map((id) => channelNames.get(id) ?? `Channel ${id}`).join(", ");
  const stacking = promotion.stopsOthers ? "Stops other promotions from applying" : promotion.stackable ? "Can be combined with other promotions" : "Cannot be combined with other promotions";
  const cantCombine = conflicts.filter((c) => c.severity === "warning").length;

  const overlaps =
    conflicts.length === 0 ? (
      <p className="pp-muted" style={{ fontSize: 13.5, margin: "4px 2px 0" }}>No other promotion applies to the same shoppers at the same time.</p>
    ) : (
      <ul className="pp-olist">
        {conflicts.map((conflict) => {
          const otherId = conflict.promotionIds.find((id) => id !== promotion.id);
          const other = otherId === undefined ? undefined : allPromotions.get(otherId);
          const exclusive = conflict.severity === "warning";

          return (
            <li key={conflict.promotionIds.join("-")}>
              <button type="button" className="pp-orow" disabled={!other} onClick={() => other && onSelect(other.id)}>
                <span className="pp-orow__main">
                  <span className="pp-orow__name">{other?.displayName ?? "Another promotion"}</span>
                  <span className="pp-orow__meta">
                    {other?.discountSummary} · {formatRange({ start: conflict.from, end: conflict.to }, timeZone)}
                  </span>
                </span>
                <span className={`pp-badge ${exclusive ? "pp-badge--red" : "pp-badge--grey"}`}>{exclusive ? "Only one applies" : "Stacks"}</span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <aside aria-label={`Details for ${promotion.displayName}`} className="pp-card pp-drawer">
      <div className="pp-drawer__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="pp-drawer__title">{promotion.displayName}</h2>
          {promotion.displayName !== promotion.name && <div className="pp-muted" style={{ fontSize: 12 }}>{promotion.name}</div>}
          <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <StatePill state={promotion.state} />
            <span className={`pp-tag${promotion.redemption === "COUPON" ? " pp-tag--code" : ""}`}>{promotion.redemption === "COUPON" ? "Coupon code" : "Automatic"}</span>
          </div>
        </div>
        <button type="button" className="pp-btn pp-btn--icon" onClick={onClose} aria-label="Close details"><CloseIcon size={16} /></button>
      </div>

      <div className="pp-tabs" role="tablist">
        <button type="button" role="tab" className="pp-tabs__tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>Details</button>
        <button type="button" role="tab" className="pp-tabs__tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Preview</button>
      </div>

      {tab === "details" ? (
        <>
        <dl className="pp-kvs">
          <Row label="Reward">{promotion.discountSummary}</Row>
          <Row label="Runs">{formatRange(promotion, timeZone)}</Row>
          <Row label="Audience">{describeAudience(promotion.audience, groupNames, segmentNames)}</Row>
          <Row label="Channels">{channels}</Row>
          <Row label="Stacking">{stacking}</Row>
          <Row label="Usage">
            {promotion.usage.current}
            {promotion.usage.max ? ` of ${promotion.usage.max} uses` : " uses (no limit)"}
          </Row>
        </dl>
        <div className="pp-drawer__section">
          <h3 className="pp-drawer__h3">
            Overlaps{conflicts.length > 0 && <span className={`pp-tabs__count${cantCombine ? " is-alert" : ""}`}>{conflicts.length}</span>}
          </h3>
          {overlaps}
        </div>
        </>
      ) : tab === "preview" ? (
        <StorefrontPreview promotion={promotion} currencySymbol={currencySymbol} />
      ) : null}
    </aside>
  );
}
