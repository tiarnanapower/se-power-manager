import { describe, expect, it } from "vitest";
import { addDaysToKey, isValidTimeZone, parseInZone, shiftDaysInZone, startOfZonedDay, zonedDayKey } from "@/lib/promo-calendar/zone";

describe("zone helpers", () => {
  it("finds the store day of an instant", () => {
    expect(zonedDayKey(new Date("2026-11-27T23:30:00Z"), "Australia/Sydney")).toBe("2026-11-28");
    expect(zonedDayKey(new Date("2026-11-27T02:00:00Z"), "America/New_York")).toBe("2026-11-26");
    expect(zonedDayKey(new Date("2026-11-27T02:00:00Z"), "UTC")).toBe("2026-11-27");
  });

  it("converts wall time to the right instant, with and without DST", () => {
    expect(startOfZonedDay("2026-10-24", "Europe/London").toISOString()).toBe("2026-10-23T23:00:00.000Z"); // BST
    expect(startOfZonedDay("2026-10-26", "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z"); // GMT
    expect(startOfZonedDay("2026-11-27", "America/New_York").toISOString()).toBe("2026-11-27T05:00:00.000Z");
  });

  it("shifts by whole days keeping the wall-clock time across a DST change", () => {
    const start = new Date("2026-10-23T23:00:00Z"); // 00:00 BST on Oct 24
    expect(shiftDaysInZone(start, 2, "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("reads offset-less times in the zone and leaves explicit offsets alone", () => {
    expect(parseInZone("2026-11-27T00:00", "America/New_York").toISOString()).toBe("2026-11-27T05:00:00.000Z");
    expect(parseInZone("2026-11-27", "UTC").toISOString()).toBe("2026-11-27T00:00:00.000Z");
    expect(parseInZone("2026-11-27T00:00:00+01:00", "America/New_York").toISOString()).toBe("2026-11-26T23:00:00.000Z");
  });

  it("validates zones and adds days to keys", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Nope/Nowhere")).toBe(false);
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});
