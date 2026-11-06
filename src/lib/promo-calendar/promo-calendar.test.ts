import { describe, expect, it } from "vitest";
import { findConflicts, audiencesOverlap } from "@/lib/promo-calendar/conflicts";
import { findCoverageGaps } from "@/lib/promo-calendar/gaps";
import { getLifecycleState } from "@/lib/promo-calendar/lifecycle";
import { toCalendarPromotion } from "@/lib/promo-calendar/from-promotion";
import type { Promotion } from "@/lib/promotions/types";

const NOW = new Date("2026-10-28T12:00:00Z");

function promo(overrides: Partial<Promotion>): Promotion {
  return {
    id: 1,
    name: "Test",
    redemption_type: "AUTOMATIC",
    status: "ENABLED",
    rules: [{ action: { cart_value: { discount: { percentage_amount: "10" } } } }],
    ...overrides,
  };
}

describe("getLifecycleState", () => {
  it("classifies by status, dates and usage", () => {
    expect(getLifecycleState(promo({ status: "DISABLED" }), NOW)).toBe("disabled");
    expect(getLifecycleState(promo({ status: "INVALID" }), NOW)).toBe("invalid");
    expect(getLifecycleState(promo({ start_date: "2026-11-01T00:00:00Z" }), NOW)).toBe("scheduled");
    expect(getLifecycleState(promo({ end_date: "2026-10-01T00:00:00Z" }), NOW)).toBe("ended");
    expect(getLifecycleState(promo({ max_uses: 5, current_uses: 5 }), NOW)).toBe("exhausted");
    expect(getLifecycleState(promo({ start_date: "2026-10-01T00:00:00Z", end_date: null }), NOW)).toBe("live");
  });
});

describe("toCalendarPromotion", () => {
  it("summarises the discount and audience", () => {
    const item = toCalendarPromotion(promo({ customer: { group_ids: [2] } }), NOW)!;

    expect(item.discountSummary).toBe("10% off order");
    expect(item.audience.everyone).toBe(false);
    expect(item.audience.groupIds).toEqual([2]);
  });

  it("skips promotions without an id", () => {
    expect(toCalendarPromotion(promo({ id: undefined }), NOW)).toBeUndefined();
  });
});

describe("audiencesOverlap", () => {
  const everyone = { everyone: true, groupIds: [], excludedGroupIds: [], hasSegments: false, segmentIds: [], excludedSegmentIds: [], minimumOrderCount: null };
  const vip = { ...everyone, everyone: false, groupIds: [1] };
  const wholesale = { ...everyone, everyone: false, groupIds: [2] };

  it("handles groups, exclusions and segments", () => {
    expect(audiencesOverlap(everyone, vip)).toBe(true);
    expect(audiencesOverlap(vip, wholesale)).toBe(false);
    expect(audiencesOverlap({ ...everyone, excludedGroupIds: [1] }, vip)).toBe(false);
    expect(audiencesOverlap({ ...vip, hasSegments: true }, wholesale)).toBe(true);
  });
});

describe("findConflicts", () => {
  const a = toCalendarPromotion(promo({ id: 1, name: "A", start_date: "2026-10-20T00:00:00Z", end_date: "2026-11-10T00:00:00Z" }), NOW)!;

  it("warns when one promotion refuses to stack", () => {
    const b = toCalendarPromotion(
      promo({ id: 2, name: "B", can_be_used_with_other_promotions: false, start_date: "2026-11-01T00:00:00Z" }),
      NOW,
    )!;
    const [conflict] = findConflicts([a, b]);

    expect(conflict.kind).toBe("exclusive-overlap");
    expect(conflict.severity).toBe("warning");
  });

  it("reports stacking as info and ignores non-overlapping or different audiences", () => {
    const stacking = toCalendarPromotion(promo({ id: 3, start_date: "2026-11-01T00:00:00Z" }), NOW)!;
    const later = toCalendarPromotion(promo({ id: 4, start_date: "2026-12-01T00:00:00Z" }), NOW)!;
    const vipOnly = toCalendarPromotion(promo({ id: 5, customer: { group_ids: [1] }, can_be_used_with_other_promotions: false }), NOW)!;

    expect(findConflicts([a, stacking])[0].severity).toBe("info");
    expect(findConflicts([a, later])).toHaveLength(0);
    expect(findConflicts([vipOnly, { ...a, audience: { ...a.audience, everyone: false, groupIds: [2] } }])).toHaveLength(0);
  });

  it("ignores coupon and inactive promotions", () => {
    const coupon = toCalendarPromotion(promo({ id: 6, redemption_type: "COUPON", can_be_used_with_other_promotions: false }), NOW)!;
    const ended = toCalendarPromotion(promo({ id: 7, end_date: "2026-01-01T00:00:00Z", can_be_used_with_other_promotions: false }), NOW)!;

    expect(findConflicts([a, coupon, ended])).toHaveLength(0);
  });
});

describe("findCoverageGaps", () => {
  it("finds runs of days with no store-wide offer", () => {
    const sale = toCalendarPromotion(promo({ start_date: "2026-11-01T00:00:00Z", end_date: "2026-11-05T23:59:59Z" }), NOW)!;
    const gaps = findCoverageGaps([sale], new Date("2026-10-28T00:00:00Z"), new Date("2026-11-30T00:00:00Z"));

    expect(gaps.map((g) => g.days)).toEqual([4, 25]);
  });
});

describe("calendar events", () => {
  it("puts open-ended promotions in the always-on strip and dated ones on the grid", async () => {
    const { isAlwaysOn, toCalendarEvent } = await import("@/lib/promo-calendar/calendar-events");
    const open = toCalendarPromotion(promo({ id: 10 }), NOW)!;
    const dated = toCalendarPromotion(promo({ id: 11, start_date: "2026-11-01T09:00:00Z", end_date: "2026-11-03T20:00:00Z" }), NOW)!;
    const event = toCalendarEvent(dated, NOW, new Set([11]))!;

    expect(isAlwaysOn(open)).toBe(true);
    expect(toCalendarEvent(open, NOW, new Set())).toBeUndefined();
    expect(event.start).toBe("2026-11-01");
    expect(event.end).toBe("2026-11-04");
    expect(event.editable).toBe(true);
    expect(event.classNames).toContain("pp-ev--conflict");
  });
});
