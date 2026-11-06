import { describe, expect, it } from "vitest";
import { buildAxis, defaultWindowStart, layoutBar, ZOOMS } from "@/lib/promo-calendar/timeline";

const d = (value: string) => new Date(value);

describe("layoutBar", () => {
  const start = "2026-11-01";

  it("positions a dated promotion by whole days", () => {
    const bar = layoutBar({ start: d("2026-11-03T00:00:00Z"), end: d("2026-11-05T23:59:59Z") }, start, "weeks", "UTC")!;

    expect(bar.left).toBe(2 * ZOOMS.weeks.dayWidth);
    expect(bar.width).toBe(3 * ZOOMS.weeks.dayWidth);
    expect(bar.clippedStart || bar.clippedEnd || bar.openEnded).toBe(false);
  });

  it("treats an end at midnight as the previous day and skips promotions outside the window", () => {
    expect(layoutBar({ start: d("2026-11-03T00:00:00Z"), end: d("2026-11-04T00:00:00Z") }, start, "weeks", "UTC")!.width).toBe(ZOOMS.weeks.dayWidth);
    expect(layoutBar({ start: d("2026-09-01T00:00:00Z"), end: d("2026-09-10T00:00:00Z") }, start, "weeks", "UTC")).toBeNull();
    expect(layoutBar({ start: d("2027-03-01T00:00:00Z"), end: null }, start, "weeks", "UTC")).toBeNull();
  });

  it("clips and flags open-ended promotions", () => {
    const bar = layoutBar({ start: d("2026-10-01T00:00:00Z"), end: null }, start, "weeks", "UTC")!;

    expect(bar).toMatchObject({ left: 0, width: ZOOMS.weeks.spanDays * ZOOMS.weeks.dayWidth, clippedStart: true, clippedEnd: true, openEnded: true });
  });

  it("uses the store's time zone for the day", () => {
    const bar = layoutBar({ start: d("2026-11-02T23:30:00Z"), end: d("2026-11-03T22:00:00Z") }, start, "weeks", "Europe/Paris")!;

    expect(bar.left).toBe(2 * ZOOMS.weeks.dayWidth); // 00:30 on Nov 3 in Paris
  });
});

describe("buildAxis", () => {
  it("builds month cells that cover the window and finds today", () => {
    const axis = buildAxis("2026-10-20", "weeks", "2026-10-28");

    expect(axis.months.map((m) => m.label)).toEqual(["October 2026", "November 2026"]);
    expect(axis.months.reduce((total, m) => total + m.width, 0)).toBe(ZOOMS.weeks.spanDays * ZOOMS.weeks.dayWidth);
    expect(axis.ticks).toHaveLength(ZOOMS.weeks.spanDays);
    expect(axis.todayLeft).toBe(8 * ZOOMS.weeks.dayWidth + ZOOMS.weeks.dayWidth / 2);
    expect(defaultWindowStart("2026-10-28", "weeks")).toBe("2026-10-22");
  });
});
