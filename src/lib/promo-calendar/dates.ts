// Calendar date helpers. Everything is UTC so the server render and the
// browser agree (no hydration mismatch) and tests are timezone independent.

export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The 42 days (6 weeks, Sunday first) that make up the month grid for the
// month containing `cursor`.
export function monthGridDays(cursor: Date): Date[] {
  const first = startOfUtcMonth(cursor);
  const gridStart = addUtcDays(first, -first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => addUtcDays(gridStart, index));
}

// Whether a promotion's [start, end] range touches the given UTC day.
// Null bounds are open ended.
export function isActiveOnDay(range: { start: Date | null; end: Date | null }, day: Date): boolean {
  const dayStart = startOfUtcDay(day).getTime();
  const dayEnd = dayStart + DAY_MS - 1;

  return (!range.start || range.start.getTime() <= dayEnd) && (!range.end || range.end.getTime() >= dayStart);
}

const formatCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let format = formatCache.get(key);

  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
    formatCache.set(key, format);
  }

  return format;
}

// Every formatter takes the time zone to show the day in (UTC by default).
export const formatDay = (date: Date, timeZone = "UTC"): string => formatter(timeZone, { month: "short", day: "numeric", year: "numeric" }).format(date);
export const formatShortDay = (date: Date, timeZone = "UTC"): string => formatter(timeZone, { month: "short", day: "numeric" }).format(date);
export const formatMonth = (date: Date, timeZone = "UTC"): string => formatter(timeZone, { month: "long", year: "numeric" }).format(date);
export const formatMonthShort = (date: Date, timeZone = "UTC"): string => formatter(timeZone, { month: "short" }).format(date);

// "Nov 1, 2026 → Nov 30, 2026", "From Nov 1, 2026", "Until Nov 30, 2026" or "Always on".
export function formatRange(range: { start: Date | null; end: Date | null }, timeZone = "UTC"): string {
  if (range.start && range.end) return `${formatDay(range.start, timeZone)} → ${formatDay(range.end, timeZone)}`;
  if (range.start) return `From ${formatDay(range.start, timeZone)}`;
  if (range.end) return `Until ${formatDay(range.end, timeZone)}`;

  return "Always on";
}
