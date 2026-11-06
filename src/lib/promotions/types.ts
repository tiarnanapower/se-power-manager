// BigCommerce v3 Promotions API shapes. Only the fields this app reads or
// edits are typed; every promotion and rule carries an index signature so
// unknown fields survive a load → edit → save round trip untouched.

export const PROMOTIONS_PATH = "/v3/promotions";

// Ids can originate from client input, so they are always URL-encoded before
// being placed in a path (prevents "../" style redirection of the store token).
export function getPromotionPath(id: number | string): string {
  return `${PROMOTIONS_PATH}/${encodeURIComponent(String(id))}`;
}

export type PromotionStatus = "ENABLED" | "DISABLED" | "INVALID";
export type RedemptionType = "AUTOMATIC" | "COUPON";

export interface Discount {
  percentage_amount?: string;
  fixed_amount?: string;
  [key: string]: unknown;
}

export interface PromotionAction {
  cart_value?: { discount: Discount; [key: string]: unknown };
  cart_items?: { discount: Discount; [key: string]: unknown };
  shipping?: { free_shipping?: boolean; [key: string]: unknown };
  gift_item?: Record<string, unknown>;
  fixed_price_set?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PromotionCondition {
  cart?: { minimum_spend?: string; minimum_quantity?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PromotionRule {
  action: PromotionAction;
  condition?: PromotionCondition;
  apply_once?: boolean;
  stop?: boolean;
  [key: string]: unknown;
}

export interface PromotionCustomer {
  group_ids?: number[];
  excluded_group_ids?: number[];
  minimum_order_count?: number;
  segments?: unknown;
  [key: string]: unknown;
}

export type NotificationType = "UPSELL" | "ELIGIBLE" | "APPLIED";
export type NotificationLocation = "HOME_PAGE" | "PRODUCT_PAGE" | "CART_PAGE";

export interface PromotionNotification {
  type: NotificationType;
  content: string;
  locations: NotificationLocation[];
}

export interface Promotion {
  id?: number;
  name: string;
  display_name?: string;
  redemption_type: RedemptionType;
  status: PromotionStatus;
  rules: PromotionRule[];
  customer?: PromotionCustomer;
  channels?: Array<{ id: number }>;
  currency_code?: string;
  start_date?: string | null;
  end_date?: string | null;
  schedule?: unknown;
  stop?: boolean;
  can_be_used_with_other_promotions?: boolean;
  max_uses?: number;
  current_uses?: number;
  notifications?: PromotionNotification[];
  created_from?: string;
  [key: string]: unknown;
}

// Fields BigCommerce owns: sending them back on create/update is rejected or
// ignored, so they are stripped before every write.
export const READ_ONLY_PROMOTION_FIELDS = ["id", "created_from", "current_uses"] as const;
