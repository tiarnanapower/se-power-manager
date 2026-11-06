// Time zone helpers. The calendar shows days the way the store's own control
// panel does, i.e. in the store's time zone, so a promotion that starts at
// "midnight on Black Friday" lands on Black Friday. Pure (Intl only).

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);

  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }

  return format;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });

    return true;
  } catch {
    return false;
  }
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): WallTime {
  const out: Record<string, number> = {};

  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }

  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

// "YYYY-MM-DD" of the given instant in the time zone.
export function zonedDayKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);

  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function wallAsUtcMs(parts: WallTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

// The instant at which the wall clock in `timeZone` shows `wall`.
export function wallTimeToInstant(wall: WallTime, timeZone: string): Date {
  const target = wallAsUtcMs(wall);
  const offsetAt = (ms: number) => wallAsUtcMs(zonedParts(new Date(ms), timeZone)) - ms;
  const first = target - offsetAt(target);
  const second = target - offsetAt(first);

  return new Date(second);
}

export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function diffDayKeys(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// The instant the given store day begins.
export function startOfZonedDay(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);

  return wallTimeToInstant({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

// Same wall-clock time, `days` days later, in the time zone (DST safe).
export function shiftDaysInZone(date: Date, days: number, timeZone: string): Date {
  const wall = zonedParts(date, timeZone);
  const [year, month, day] = addDaysToKey(`${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`, days).split("-").map(Number);

  return wallTimeToInstant({ ...wall, year, month, day }, timeZone);
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

// Accepts either a full ISO instant ("...Z" / "+01:00") or a wall-clock time
// with no offset ("2026-11-27T00:00"), which is read in `timeZone`.
export function parseInZone(value: string, timeZone: string): Date {
  const match = WALL_TIME.exec(value.trim());

  if (!match) return new Date(value);

  return wallTimeToInstant(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0) },
    timeZone,
  );
}

// "BST", "GMT+1", "EST"... for labels.
export function zoneAbbreviation(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
