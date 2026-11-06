import type { RewardKind } from "@/lib/promo-calendar/types";
import type { Promotion, PromotionRule } from "@/lib/promotions/types";

function describeRule(rule: PromotionRule): string | undefined {
  const { action } = rule;
  const discount = action.cart_value?.discount ?? action.cart_items?.discount;
  const scope = action.cart_value ? "order" : "items";

  if (discount?.percentage_amount) return `${Number(discount.percentage_amount)}% off ${scope}`;
  if (discount?.fixed_amount) return `${discount.fixed_amount} off ${scope}`;
  if (action.shipping?.free_shipping) return "Free shipping";
  if (action.gift_item) return "Free gift";
  if (action.fixed_price_set) return "Fixed price";

  return undefined;
}

// A short human label for a promotion's reward, e.g. "15% off order" or
// "10% off items, Free shipping". Falls back to "Custom rules".
export function describeDiscount(promotion: Promotion): string {
  const parts = (promotion.rules ?? []).map(describeRule).filter((part): part is string => Boolean(part));
  const unique = [...new Set(parts)];

  return unique.length > 0 ? unique.join(", ") : "Custom rules";
}

// The main kind of reward, used to colour promotions on the calendar.
export function rewardKind(promotion: Promotion): RewardKind {
  for (const rule of promotion.rules ?? []) {
    const { action } = rule;
    const discount = action.cart_value?.discount ?? action.cart_items?.discount;

    if (discount?.percentage_amount) return "percent";
    if (discount?.fixed_amount) return "amount";
    if (action.shipping?.free_shipping) return "shipping";
    if (action.gift_item) return "gift";
  }

  return "other";
}

export function rewardValue(promotion: Promotion): number | null {
  for (const rule of promotion.rules ?? []) {
    const discount = rule.action.cart_value?.discount ?? rule.action.cart_items?.discount;
    const value = Number(discount?.percentage_amount ?? discount?.fixed_amount);

    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}
