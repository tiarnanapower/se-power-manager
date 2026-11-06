import type { Audience } from "@/lib/promo-calendar/types";

// Whether a customer group is eligible for a promotion with this audience.
// Segment targeting is opaque, so it is treated as possibly eligible.
export function appliesToGroup(audience: Audience, groupId: number): boolean {
  if (audience.excludedGroupIds.includes(groupId)) return false;
  if (audience.hasSegments) return true;

  return audience.everyone || audience.groupIds.includes(groupId);
}

// A readable audience label, e.g. "Everyone", "Everyone except Wholesale", "VIP, Trade".
export function describeAudience(audience: Audience, groupNames: Map<number, string>, segmentNames?: Map<string, string>): string {
  const name = (id: number) => groupNames.get(id) ?? `Group ${id}`;
  const parts: string[] = [];

  if (audience.everyone) {
    parts.push(
      audience.excludedGroupIds.length > 0
        ? `Everyone except ${audience.excludedGroupIds.map(name).join(", ")}`
        : "Everyone",
    );
  } else {
    parts.push(audience.groupIds.map(name).join(", "));
  }

  if (audience.segmentIds.length > 0) parts.push(`Segment: ${audience.segmentIds.map((id) => segmentNames?.get(id) ?? "Unnamed segment").join(", ")}`);
  if (audience.excludedSegmentIds.length > 0) parts.push(`Not in: ${audience.excludedSegmentIds.map((id) => segmentNames?.get(id) ?? "Unnamed segment").join(", ")}`);
  if (audience.hasSegments && audience.segmentIds.length === 0 && audience.excludedSegmentIds.length === 0) parts.push("targeted segments");
  if (audience.minimumOrderCount) parts.push(`${audience.minimumOrderCount}+ past orders`);

  return parts.join(" · ");
}

// Whether shoppers in this segment can use the promotion. Promotions with no
// segment rule apply to everyone (segment members included); a group-only
// promotion is treated as not for the segment.
export function appliesToSegment(audience: Audience, segmentId: string): boolean {
  if (audience.excludedSegmentIds.includes(segmentId)) return false;
  if (audience.segmentIds.length > 0) return audience.segmentIds.includes(segmentId);
  if (audience.hasSegments) return true;

  return audience.everyone;
}
