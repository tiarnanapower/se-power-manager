"use client";

import { useState } from "react";
import { InfinityIcon } from "@/components/shell/icons";
import { describeAudience } from "@/lib/promo-calendar/audience-filter";
import { formatShortDay } from "@/lib/promo-calendar/dates";
import type { CalendarPromotion, LifecycleState } from "@/lib/promo-calendar/types";

const COLLAPSED_AT = 5;
const STATE_NOTE: Partial<Record<LifecycleState, string>> = { scheduled: "Scheduled", disabled: "Disabled", ended: "Ended", exhausted: "Used up", invalid: "Invalid" };

function sinceLabel(promotion: CalendarPromotion, timeZone: string): string {
  if (!promotion.start) return "No start date";

  return `${promotion.state === "scheduled" ? "Starts" : "Since"} ${formatShortDay(promotion.start, timeZone)}`;
}

interface Props {
  promotions: CalendarPromotion[];
  selectedId: number | undefined;
  groupNames: Map<number, string>;
  timeZone: string;
  segmentNames?: Map<string, string>;
  onSelect(id: number): void;
}

// Promotions with no end date never finish, so bars across every day would bury
// the calendar. They sit in a compact row above it instead.
export function AlwaysOnCards({ promotions, selectedId, groupNames, timeZone, segmentNames, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (promotions.length === 0) return null;

  return (
    <section className="pp-aon" aria-label="Always-on promotions">
      <div className="pp-aon__head">
        <h2 className="pp-aon__title">
          <InfinityIcon size={16} /> Always on
        </h2>
        <span className="pp-aon__sub">{promotions.length} with no end date</span>
        <span className="pp-aon__key" aria-label="Colour key">
          <span className="pp-redeem--auto"><span className="pp-kind-dot" aria-hidden />Automatic</span>
          <span className="pp-redeem--code"><span className="pp-kind-dot" aria-hidden />Coupon code</span>
        </span>
        {promotions.length > COLLAPSED_AT && (
          <button type="button" className="pp-link" style={{ marginLeft: "auto" }} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : `View all ${promotions.length}`}
          </button>
        )}
      </div>
      <div className={`pp-aon__row${expanded ? " is-grid" : ""}`}>
        {promotions.map((promotion) => {
          const note = STATE_NOTE[promotion.state];

          return (
            <button key={promotion.id} type="button" className={`pp-aon-card ${promotion.redemption === "COUPON" ? "pp-redeem--code" : "pp-redeem--auto"}`} aria-current={promotion.id === selectedId} onClick={() => onSelect(promotion.id)}>
              <span className="pp-aon-card__name">
                <span className="pp-kind-dot" aria-hidden />
                <span className="pp-aon-card__title">{promotion.displayName}</span>
              </span>
              <span className="pp-aon-card__reward">{promotion.discountSummary}</span>
              <span className="pp-aon-card__meta">
                {[note, describeAudience(promotion.audience, groupNames, segmentNames), sinceLabel(promotion, timeZone)].filter(Boolean).join(" · ")}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
