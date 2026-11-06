import type { CalendarPromotion } from "@/lib/promo-calendar/types";
import { addDaysToKey, diffDayKeys, startOfZonedDay, zonedDayKey } from "@/lib/promo-calendar/zone";

export interface DateGap {
  from: Date;
  to: Date;
  days: number;
}

// Runs of whole days (in the store's time zone) inside [rangeStart, rangeEnd]
// where no live or scheduled AUTOMATIC promotion applies to everyone, i.e.
// where the storefront has no store-wide offer. Gaps shorter than `minDays`
// are ignored. `from`/`to` are the instants those days begin.
export function findCoverageGaps(
  promotions: CalendarPromotion[],
  rangeStart: Date,
  rangeEnd: Date,
  minDays = 3,
  timeZone = "UTC",
): DateGap[] {
  const wide = promotions.filter(
    (p) => p.redemption === "AUTOMATIC" && (p.state === "live" || p.state === "scheduled") && p.audience.everyone,
  );
  const gaps: DateGap[] = [];
  const lastKey = zonedDayKey(rangeEnd, timeZone);
  let runStart: string | null = null;

  const close = (endExclusiveKey: string) => {
    if (runStart === null) return;

    const days = diffDayKeys(runStart, endExclusiveKey);

    if (days >= minDays) {
      gaps.push({ from: startOfZonedDay(runStart, timeZone), to: startOfZonedDay(addDaysToKey(endExclusiveKey, -1), timeZone), days });
    }

    runStart = null;
  };

  for (let key = zonedDayKey(rangeStart, timeZone); key <= lastKey; key = addDaysToKey(key, 1)) {
    const dayStart = startOfZonedDay(key, timeZone).getTime();
    const dayEnd = startOfZonedDay(addDaysToKey(key, 1), timeZone).getTime() - 1;
    const covered = wide.some((p) => (!p.start || p.start.getTime() <= dayEnd) && (!p.end || p.end.getTime() >= dayStart));

    if (covered) close(key);
    else if (runStart === null) runStart = key;
  }

  close(addDaysToKey(lastKey, 1));

  return gaps;
}
