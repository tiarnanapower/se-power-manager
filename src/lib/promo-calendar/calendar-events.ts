import { addDaysToKey, zonedDayKey } from "@/lib/promo-calendar/zone";
import type { CalendarPromotion } from "@/lib/promo-calendar/types";

export interface CalendarEvent {
  id: string;
  title: string;
  // All-day events: `end` is exclusive (the day after the last day).
  start: string;
  end: string;
  allDay: true;
  editable: boolean;
  classNames: string[];
  extendedProps: { promotionId: number; summary: string; conflict: boolean; coupon: boolean };
}

// Promotions with no end date never "finish", so drawing them as bars across
// every day buries the calendar. They are shown in the Always-on strip instead.
export function isAlwaysOn(promotion: CalendarPromotion): boolean {
  return promotion.end === null;
}

// Ended, invalid and used-up promotions can't meaningfully be rescheduled.
function isEditable(promotion: CalendarPromotion): boolean {
  return promotion.start !== null && promotion.end !== null && (promotion.state === "live" || promotion.state === "scheduled" || promotion.state === "disabled");
}

// Days are the store's days: a promotion that runs 00:00 to 23:59 on Black
// Friday in the store's time zone sits on Black Friday.
export function toCalendarEvent(promotion: CalendarPromotion, now: Date, conflictIds: Set<number>, timeZone = "UTC"): CalendarEvent | undefined {
  if (!promotion.end) return undefined;

  // A promotion with an end date but no start has been running "forever":
  // draw it from today (or its end date if that already passed).
  const start = promotion.start ?? (promotion.end < now ? promotion.end : now);
  const startKey = zonedDayKey(start, timeZone);
  // An end at exactly midnight belongs to the day before.
  const lastKey = zonedDayKey(new Date(Math.max(promotion.end.getTime() - 1, start.getTime())), timeZone);
  const conflict = conflictIds.has(promotion.id);

  return {
    id: String(promotion.id),
    title: promotion.displayName,
    start: startKey,
    end: addDaysToKey(lastKey < startKey ? startKey : lastKey, 1),
    allDay: true,
    editable: isEditable(promotion),
    classNames: ["pp-ev", `pp-ev--${promotion.state}`, `pp-ev--k-${promotion.rewardKind}`, ...(conflict ? ["pp-ev--conflict"] : [])],
    extendedProps: { promotionId: promotion.id, summary: promotion.discountSummary, conflict, coupon: promotion.redemption === "COUPON" },
  };
}
