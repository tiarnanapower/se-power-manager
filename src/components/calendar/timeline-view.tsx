"use client";

import { useMemo } from "react";
import { TagIcon } from "@/components/shell/icons";
import { formatRange } from "@/lib/promo-calendar/dates";
import { buildAxis, layoutBar, type TimelineZoom, ZOOMS } from "@/lib/promo-calendar/timeline";
import type { CalendarPromotion } from "@/lib/promo-calendar/types";
import { addDaysToKey } from "@/lib/promo-calendar/zone";

const LEFT = 272;
const startOrEarliest = (p: CalendarPromotion) => p.start?.getTime() ?? Number.NEGATIVE_INFINITY;

interface Props {
  promotions: CalendarPromotion[];
  conflictIds: Set<number>;
  gapDays: Set<string>;
  timeZone: string;
  todayKey: string;
  startKey: string;
  zoom: TimelineZoom;
  selectedId: number | undefined;
  onSelect(id: number): void;
}

// A waterfall: one row per promotion, ordered by start date, drawn as a bar on a
// shared day axis so what overlaps, and what's coming, reads at a glance.
export function TimelineView({ promotions, conflictIds, gapDays, timeZone, todayKey, startKey, zoom, selectedId, onSelect }: Props) {
  const { spanDays, dayWidth } = ZOOMS[zoom];
  const axis = useMemo(() => buildAxis(startKey, zoom, todayKey), [startKey, zoom, todayKey]);
  const trackWidth = spanDays * dayWidth;

  const rows = useMemo(() => {
    const placed = promotions
      .map((promotion) => ({ promotion, bar: layoutBar(promotion, startKey, zoom, timeZone) }))
      .filter((row): row is { promotion: CalendarPromotion; bar: NonNullable<ReturnType<typeof layoutBar>> } => row.bar !== null)
      .sort((a, b) => startOrEarliest(a.promotion) - startOrEarliest(b.promotion) || a.promotion.id - b.promotion.id);

    return { dated: placed.filter((row) => row.promotion.end !== null), always: placed.filter((row) => row.promotion.end === null) };
  }, [promotions, startKey, zoom, timeZone]);

  const gapCells = useMemo(() => {
    const cells: number[] = [];

    for (let index = 0; index < spanDays; index++) {
      if (gapDays.has(addDaysToKey(startKey, index))) cells.push(index);
    }

    return cells;
  }, [gapDays, startKey, spanDays]);

  const renderRow = ({ promotion, bar }: (typeof rows.dated)[number]) => {
    const wide = bar.width >= 120;

    return (
      <div key={promotion.id} className="pp-tl__row">
        <button type="button" className="pp-tl__name" aria-current={promotion.id === selectedId} onClick={() => onSelect(promotion.id)}>
          <span className={`pp-ev--k-${promotion.rewardKind}`}><span className="pp-kind-dot" aria-hidden /></span>
          <span className="pp-tl__label">
            <span className="pp-tl__title">{promotion.displayName}{conflictIds.has(promotion.id) && <span className="pp-tl__conflict" title="Overlaps another promotion that can't combine with it" />}</span>
            <span className="pp-tl__sub">{promotion.discountSummary}</span>
          </span>
          {promotion.redemption === "COUPON" && <TagIcon size={13} />}
        </button>
        <div className="pp-tl__track" style={{ width: trackWidth }}>
          <button
            type="button"
            className={`pp-tl__bar pp-ev--k-${promotion.rewardKind} pp-tl__bar--${promotion.state}${bar.openEnded ? " is-open" : ""}${bar.clippedStart ? " is-clip-start" : ""}${bar.clippedEnd && !bar.openEnded ? " is-clip-end" : ""}`}
            style={{ left: bar.left, width: bar.width }}
            aria-current={promotion.id === selectedId}
            title={`${promotion.displayName} · ${promotion.discountSummary} · ${formatRange(promotion, timeZone)}`}
            onClick={() => onSelect(promotion.id)}
          >
            {wide && <span className="pp-tl__bar-text">{promotion.discountSummary}</span>}
          </button>
        </div>
      </div>
    );
  };

  if (rows.dated.length + rows.always.length === 0) {
    return <p className="pp-muted" style={{ padding: "28px 20px", margin: 0, textAlign: "center" }}>No promotions in this period.</p>;
  }

  return (
    <div className="pp-tl" style={{ ["--tl-left" as string]: `${LEFT}px`, ["--tl-day" as string]: `${dayWidth}px` }}>
      <div className="pp-tl__inner" style={{ width: LEFT + trackWidth }}>
        <div className="pp-tl__head">
          <div className="pp-tl__corner">Promotion</div>
          <div className="pp-tl__axis" style={{ width: trackWidth }}>
            <div className="pp-tl__months">
              {axis.months.map((cell) => (
                <span key={cell.key} className="pp-tl__month" style={{ left: cell.left, width: cell.width }}>{cell.label}</span>
              ))}
            </div>
            <div className="pp-tl__ticks">
              {axis.ticks.map((cell) => (
                <span key={cell.key} className={`pp-tl__tick${cell.weekend ? " is-weekend" : ""}${cell.today ? " is-today" : ""}`} style={{ left: cell.left, width: cell.width }}>{cell.label}</span>
              ))}
              {axis.todayLeft !== null && <span className="pp-tl__today-flag" style={{ left: axis.todayLeft }}>Today</span>}
            </div>
          </div>
        </div>

        <div className="pp-tl__body">
          <div className={`pp-tl__layer pp-tl__layer--${zoom}`} style={{ left: LEFT, width: trackWidth }} aria-hidden>
            {gapCells.map((index) => (
              <span key={index} className="pp-tl__gap" style={{ left: index * dayWidth, width: dayWidth }} />
            ))}
            {axis.todayLeft !== null && <span className="pp-tl__today" style={{ left: axis.todayLeft }} />}
          </div>

          {rows.dated.length > 0 && <div className="pp-tl__group"><span>Scheduled campaigns</span><b>{rows.dated.length}</b></div>}
          {rows.dated.map(renderRow)}
          {rows.always.length > 0 && <div className="pp-tl__group"><span>Always on</span><b>{rows.always.length}</b><em>No end date</em></div>}
          {rows.always.map(renderRow)}
        </div>
      </div>
    </div>
  );
}
