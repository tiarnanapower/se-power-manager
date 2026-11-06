import { describe, expect, it } from "vitest";
import { appliesToSegment, describeAudience } from "@/lib/promo-calendar/audience-filter";
import { extractSegmentIds } from "@/lib/promo-calendar/segments";

const A = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const B = "11111111-2222-4333-8444-555555555555";
const base = { everyone: true, groupIds: [], excludedGroupIds: [], hasSegments: false, segmentIds: [], excludedSegmentIds: [], minimumOrderCount: null };

describe("extractSegmentIds", () => {
  it("reads includes and excludes from different shapes", () => {
    expect(extractSegmentIds({ include: [A], exclude: [B] })).toEqual({ include: [A], exclude: [B] });
    expect(extractSegmentIds([A, "not-a-uuid"])).toEqual({ include: [A], exclude: [] });
    expect(extractSegmentIds({ excluded_segment_ids: [B] })).toEqual({ include: [], exclude: [B] });
    expect(extractSegmentIds(undefined)).toEqual({ include: [], exclude: [] });
  });
});

describe("segment audiences", () => {
  it("matches segments and describes them with names", () => {
    expect(appliesToSegment({ ...base, hasSegments: true, segmentIds: [A] }, A)).toBe(true);
    expect(appliesToSegment({ ...base, hasSegments: true, segmentIds: [A] }, B)).toBe(false);
    expect(appliesToSegment({ ...base, hasSegments: true, excludedSegmentIds: [B] }, B)).toBe(false);
    expect(appliesToSegment(base, B)).toBe(true);
    expect(describeAudience({ ...base, everyone: false, hasSegments: true, segmentIds: [A] }, new Map(), new Map([[A, "VIP"]]))).toContain("Segment: VIP");
  });
});
