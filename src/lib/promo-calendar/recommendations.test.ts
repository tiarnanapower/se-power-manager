import { describe, expect, it } from "vitest";
import { buildRecommendations, seasonalMoments } from "@/lib/promo-calendar/recommendations";
import type { CalendarPromotion } from "@/lib/promo-calendar/types";

const base: CalendarPromotion = {
  id: 1, name: "n", displayName: "Sale", redemption: "AUTOMATIC", state: "live", start: new Date("2026-10-01T00:00:00Z"), end: null,
  audience: { everyone: true, groupIds: [], excludedGroupIds: [], hasSegments: false, segmentIds: [], excludedSegmentIds: [], minimumOrderCount: null },
  channelIds: [], stackable: true, stopsOthers: false, discountSummary: "10% off order", rewardKind: "percent", rewardValue: 10, notifications: [], usage: { current: 0, max: null },
};
const NOW = new Date("2026-10-28T12:00:00Z");
const run = (promotions: CalendarPromotion[], groups: Array<{ id: number; name: string }> = []) =>
  buildRecommendations({ promotions, conflicts: [], gaps: [], groups, now: NOW, timeZone: "UTC" });

describe("seasonalMoments", () => {
  it("finds Black Friday and Cyber Monday", () => {
    const moments = seasonalMoments(2026);

    expect(moments.find((m) => m.id === "black-friday-2026")?.startKey).toBe("2026-11-27");
    expect(moments.find((m) => m.id === "cyber-monday-2026")?.startKey).toBe("2026-11-30");
    expect(seasonalMoments(2027).find((m) => m.id === "black-friday-2027")?.startKey).toBe("2027-11-26");
  });
});

describe("buildRecommendations", () => {
  it("asks for a Black Friday plan when only always-on offers exist", () => {
    const recs = run([base]);

    expect(recs.some((r) => r.id === "black-friday-2026" && r.priority === "high")).toBe(true);
  });

  it("stops asking once a dated campaign covers the moment", () => {
    const campaign = { ...base, id: 2, start: new Date("2026-11-25T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };
    const ids = run([campaign]).map((r) => r.id);

    expect(ids).not.toContain("black-friday-2026");
    expect(ids).not.toContain("cyber-monday-2026");
  });

  it("flags groups with no targeted offer and campaigns ending soon", () => {
    const ending = { ...base, id: 3, end: new Date("2026-10-30T23:59:59Z") };
    const recs = run([ending], [{ id: 5, name: "VIP" }]);

    expect(recs.some((r) => r.id === "audience-5")).toBe(true);
    expect(recs.find((r) => r.id === "ending-3")?.priority).toBe("high");
  });
});
