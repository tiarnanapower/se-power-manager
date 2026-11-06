// Layout maths for the waterfall (Gantt-style) timeline. Pure and unit tested:
// the view just positions what this returns.
import { addDaysToKey, diffDayKeys, zonedDayKey } from "@/lib/promo-calendar/zone";

export type TimelineZoom = "weeks" | "months" | "year";

export const ZOOMS: Record<TimelineZoom, { label: string; spanDays: number; dayWidth: number }> = {
  weeks: { label: "Weeks", spanDays: 42, dayWidth: 36 },
  months: { label: "Months", spanDays: 120, dayWidth: 16 },
  year: { label: "Year", spanDays: 365, dayWidth: 5 },
};

// A sensible first window: a little history, mostly the future.
export function defaultWindowStart(todayKey: string, zoom: TimelineZoom): string {
  return addDaysToKey(todayKey, -Math.round(ZOOMS[zoom].spanDays * 0.15));
}

export function shiftWindow(startKey: string, zoom: TimelineZoom, direction: -1 | 1): string {
  return addDaysToKey(startKey, direction * Math.round(ZOOMS[zoom].spanDays * 0.7));
}

export interface TimelineBar {
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  openEnded: boolean;
}

// Where a promotion's bar sits in the window, or null if it doesn't touch it.
// Days are the store's days; the end day is inclusive and an end at exactly
// midnight belongs to the day before.
export function layoutBar(range: { start: Date | null; end: Date | null }, windowStartKey: string, zoom: TimelineZoom, timeZone: string): TimelineBar | null {
  const { spanDays, dayWidth } = ZOOMS[zoom];
  const startIndex = range.start ? diffDayKeys(windowStartKey, zonedDayKey(range.start, timeZone)) : -Infinity;
  const endIndex = range.end ? diffDayKeys(windowStartKey, zonedDayKey(new Date(Math.max(range.end.getTime() - 1, range.start?.getTime() ?? 0)), timeZone)) : Infinity;

  if (endIndex < 0 || startIndex > spanDays - 1) return null;

  const from = Math.max(startIndex, 0);
  const to = Math.min(endIndex, spanDays - 1);

  return {
    left: from * dayWidth,
    width: (to - from + 1) * dayWidth,
    clippedStart: startIndex < 0,
    clippedEnd: endIndex > spanDays - 1,
    openEnded: range.end === null,
  };
}

export interface AxisCell {
  key: string;
  label: string;
  left: number;
  width: number;
  weekend?: boolean;
  today?: boolean;
}

export interface Axis {
  months: AxisCell[];
  ticks: AxisCell[];
  todayLeft: number | null;
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const asDate = (key: string) => new Date(`${key}T00:00:00Z`);

export function buildAxis(windowStartKey: string, zoom: TimelineZoom, todayKey: string): Axis {
  const { spanDays, dayWidth } = ZOOMS[zoom];
  const months: AxisCell[] = [];
  const ticks: AxisCell[] = [];

  for (let index = 0; index < spanDays; index++) {
    const key = addDaysToKey(windowStartKey, index);
    const date = asDate(key);
    const weekday = date.getUTCDay();
    const monthStart = date.getUTCDate() === 1;

    if (months.length === 0 || monthStart) {
      months.push({ key, label: zoom === "year" ? monthShort.format(date) : monthFormat.format(date), left: index * dayWidth, width: 0 });
    }

    months[months.length - 1].width += dayWidth;

    if (zoom === "weeks") {
      ticks.push({ key, label: String(date.getUTCDate()), left: index * dayWidth, width: dayWidth, weekend: weekday === 0 || weekday === 6, today: key === todayKey });
    } else if (zoom === "months" && weekday === 1) {
      ticks.push({ key, label: `${date.getUTCDate()}`, left: index * dayWidth, width: 7 * dayWidth });
    }
  }

  const todayIndex = diffDayKeys(windowStartKey, todayKey);

  return { months, ticks, todayLeft: todayIndex >= 0 && todayIndex < spanDays ? todayIndex * dayWidth + dayWidth / 2 : null };
}
