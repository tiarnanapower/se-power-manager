import { describeDiscount, rewardKind, rewardValue } from "@/lib/promo-calendar/describe";
import { extractSegmentIds } from "@/lib/promo-calendar/segments";
import { getLifecycleState, parseDate } from "@/lib/promo-calendar/lifecycle";
import type { Audience, CalendarPromotion } from "@/lib/promo-calendar/types";
import type { Promotion } from "@/lib/promotions/types";

export function toAudience(promotion: Promotion): Audience {
  const groupIds = promotion.customer?.group_ids ?? [];
  const segments = promotion.customer?.segments;
  const segmentIds = extractSegmentIds(segments);

  return {
    everyone: groupIds.length === 0,
    groupIds,
    excludedGroupIds: promotion.customer?.excluded_group_ids ?? [],
    hasSegments: segments !== undefined && segments !== null && JSON.stringify(segments) !== "{}",
    segmentIds: segmentIds.include,
    excludedSegmentIds: segmentIds.exclude,
    minimumOrderCount: promotion.customer?.minimum_order_count ?? null,
  };
}

export function toCalendarPromotion(promotion: Promotion, now: Date): CalendarPromotion | undefined {
  // Promotions without an id can't exist on a store; skip anything malformed.
  if (typeof promotion.id !== "number") return undefined;

  const max = promotion.max_uses ?? 0;

  return {
    id: promotion.id,
    name: promotion.name,
    displayName: promotion.display_name || promotion.name,
    redemption: promotion.redemption_type,
    state: getLifecycleState(promotion, now),
    start: parseDate(promotion.start_date),
    end: parseDate(promotion.end_date),
    audience: toAudience(promotion),
    channelIds: (promotion.channels ?? []).map((channel) => channel.id),
    stackable: promotion.can_be_used_with_other_promotions !== false,
    stopsOthers: promotion.stop === true,
    discountSummary: describeDiscount(promotion),
    rewardKind: rewardKind(promotion),
    rewardValue: rewardValue(promotion),
    notifications: (promotion.notifications ?? []).map((n) => ({ type: n.type, content: n.content, locations: n.locations ?? [] })),
    usage: { current: promotion.current_uses ?? 0, max: max > 0 ? max : null },
  };
}

export function toCalendarPromotions(promotions: Promotion[], now: Date): CalendarPromotion[] {
  return promotions
    .map((promotion) => toCalendarPromotion(promotion, now))
    .filter((item): item is CalendarPromotion => item !== undefined);
}
