import type { Audience, CalendarPromotion, Conflict } from "@/lib/promo-calendar/types";

const INACTIVE = new Set(["ended", "disabled", "invalid", "exhausted"]);

// Whether two audiences can include the same shopper. `everyone` audiences
// minus their exclusions overlap any group not excluded by either side.
// Segments are opaque, so they are conservatively treated as overlapping.
export function audiencesOverlap(a: Audience, b: Audience): boolean {
  if (a.hasSegments || b.hasSegments) return true;
  if (a.everyone && b.everyone) return true;

  const excluded = new Set([...a.excludedGroupIds, ...b.excludedGroupIds]);

  if (a.everyone) return b.groupIds.some((id) => !a.excludedGroupIds.includes(id));
  if (b.everyone) return a.groupIds.some((id) => !b.excludedGroupIds.includes(id));

  return a.groupIds.some((id) => b.groupIds.includes(id) && !excluded.has(id));
}

// Empty channel lists mean "every channel".
export function channelsOverlap(a: number[], b: number[]): boolean {
  if (a.length === 0 || b.length === 0) return true;

  return a.some((id) => b.includes(id));
}

// The shared window of two date ranges, or undefined if they never overlap.
// Null bounds are open ended.
export function overlapWindow(
  a: Pick<CalendarPromotion, "start" | "end">,
  b: Pick<CalendarPromotion, "start" | "end">,
): { from: Date | null; to: Date | null } | undefined {
  const from = a.start && b.start ? (a.start > b.start ? a.start : b.start) : (a.start ?? b.start);
  const to = a.end && b.end ? (a.end < b.end ? a.end : b.end) : (a.end ?? b.end);

  if (from && to && from.getTime() > to.getTime()) return undefined;

  return { from, to };
}

// Finds promotions that run at the same time for the same shoppers on the same
// channel. If either one refuses to stack (or stops further promotions) it is a
// warning, because only one will apply; if both stack it is an info notice,
// because their discounts combine. Only currently live or scheduled
// AUTOMATIC promotions are compared: coupons are opt-in per shopper.
export function findConflicts(promotions: CalendarPromotion[]): Conflict[] {
  const candidates = promotions.filter((p) => p.redemption === "AUTOMATIC" && !INACTIVE.has(p.state));
  const conflicts: Conflict[] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];

      if (!channelsOverlap(a.channelIds, b.channelIds)) continue;
      if (!audiencesOverlap(a.audience, b.audience)) continue;

      const window = overlapWindow(a, b);

      if (!window) continue;

      const exclusive = !a.stackable || !b.stackable || a.stopsOthers || b.stopsOthers;

      conflicts.push({
        kind: exclusive ? "exclusive-overlap" : "stacking",
        severity: exclusive ? "warning" : "info",
        promotionIds: [a.id, b.id],
        from: window.from,
        to: window.to,
        message: exclusive
          ? `"${a.displayName}" and "${b.displayName}" overlap for the same shoppers but can't both apply, so only one will win.`
          : `"${a.displayName}" and "${b.displayName}" overlap for the same shoppers and will stack.`,
      });
    }
  }

  return conflicts;
}
