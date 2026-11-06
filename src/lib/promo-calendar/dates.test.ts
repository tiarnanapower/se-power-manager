import { describe, expect, it } from "vitest";
import { addUtcMonths, formatRange, isActiveOnDay, monthGridDays } from "@/lib/promo-calendar/dates";
import { appliesToGroup, describeAudience } from "@/lib/promo-calendar/audience-filter";

describe("dates", () => {
  it("builds a 6-week Sunday-first grid", () => {
    const days = monthGridDays(new Date("2026-10-15T00:00:00Z"));

    expect(days).toHaveLength(42);
    expect(days[0].toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(days[0].getUTCDay()).toBe(0);
  });

  it("moves between months and checks day activity with open bounds", () => {
    expect(addUtcMonths(new Date("2026-12-20T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(isActiveOnDay({ start: null, end: new Date("2026-11-05T10:00:00Z") }, new Date("2026-11-05T00:00:00Z"))).toBe(true);
    expect(isActiveOnDay({ start: new Date("2026-11-06T00:00:00Z"), end: null }, new Date("2026-11-05T00:00:00Z"))).toBe(false);
    expect(formatRange({ start: null, end: null })).toBe("Always on");
  });
});

describe("audience helpers", () => {
  const names = new Map([[1, "VIP"], [2, "Wholesale"]]);
  const base = { everyone: true, groupIds: [], excludedGroupIds: [], hasSegments: false, segmentIds: [], excludedSegmentIds: [], minimumOrderCount: null };

  it("matches groups and describes audiences", () => {
    expect(appliesToGroup(base, 1)).toBe(true);
    expect(appliesToGroup({ ...base, excludedGroupIds: [2] }, 2)).toBe(false);
    expect(appliesToGroup({ ...base, everyone: false, groupIds: [1] }, 2)).toBe(false);
    expect(describeAudience({ ...base, excludedGroupIds: [2] }, names)).toBe("Everyone except Wholesale");
    expect(describeAudience({ ...base, everyone: false, groupIds: [1], minimumOrderCount: 3 }, names)).toBe("VIP · 3+ past orders");
  });
});
