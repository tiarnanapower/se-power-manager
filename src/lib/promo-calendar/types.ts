// Calendar-facing view of a promotion: everything the UI, conflict engine and
// copilot need, derived from the raw BigCommerce promotion. Pure data, no I/O.

export type RewardKind = "percent" | "amount" | "shipping" | "gift" | "other";

export type LifecycleState = "live" | "scheduled" | "ended" | "exhausted" | "disabled" | "invalid";

// Who a promotion applies to. `everyone` means no group restriction (guests
// and ungrouped customers included); excluded groups still apply.
export interface Audience {
  everyone: boolean;
  groupIds: number[];
  excludedGroupIds: number[];
  // Segments (Enterprise) are opaque here, so overlap checks treat them as "unknown, assume overlap".
  hasSegments: boolean;
  // Segment UUIDs the promotion targets / excludes, where they can be read.
  segmentIds: string[];
  excludedSegmentIds: string[];
  minimumOrderCount: number | null;
}

export interface CalendarPromotion {
  id: number;
  name: string;
  displayName: string;
  redemption: "AUTOMATIC" | "COUPON";
  state: LifecycleState;
  // null start = already started; null end = never expires.
  start: Date | null;
  end: Date | null;
  audience: Audience;
  // Empty = every channel.
  channelIds: number[];
  stackable: boolean;
  stopsOthers: boolean;
  discountSummary: string;
  rewardKind: RewardKind;
  // The percentage or amount for simple discounts, null otherwise.
  rewardValue: number | null;
  // Storefront messages (banner, eligible, applied) and where they show.
  notifications: Array<{ type: "UPSELL" | "ELIGIBLE" | "APPLIED"; content: string; locations: Array<"HOME_PAGE" | "PRODUCT_PAGE" | "CART_PAGE"> }>;
  usage: { current: number; max: number | null };
}

export type ConflictSeverity = "warning" | "info";
export type ConflictKind = "exclusive-overlap" | "stacking";

export interface Conflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  promotionIds: [number, number];
  // Overlap window shared by both promotions (null bounds = open ended).
  from: Date | null;
  to: Date | null;
  message: string;
}
