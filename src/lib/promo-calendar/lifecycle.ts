import type { Promotion } from "@/lib/promotions/types";
import type { LifecycleState } from "@/lib/promo-calendar/types";

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

// Where a promotion is in its life at `now`. INVALID and DISABLED are decided
// by BigCommerce's status; for ENABLED promotions the dates and usage cap
// decide.
export function getLifecycleState(promotion: Promotion, now: Date): LifecycleState {
  if (promotion.status === "INVALID") return "invalid";
  if (promotion.status === "DISABLED") return "disabled";

  const start = parseDate(promotion.start_date);
  const end = parseDate(promotion.end_date);

  if (end && end.getTime() < now.getTime()) return "ended";
  if (start && start.getTime() > now.getTime()) return "scheduled";

  const max = promotion.max_uses ?? 0;

  if (max > 0 && (promotion.current_uses ?? 0) >= max) return "exhausted";

  return "live";
}
