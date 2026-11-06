// Draft specs: the small, validated vocabulary the copilot can propose.
// Pure (no I/O) so it is unit tested and shared by the server tools, the
// confirm-and-apply server actions and the draft card. The model never writes
// raw BigCommerce JSON; drafts are compiled from these specs.
import { z } from "zod";
import { describeAudience } from "@/lib/promo-calendar/audience-filter";
import { toAudience } from "@/lib/promo-calendar/from-promotion";
import { describeDiscount } from "@/lib/promo-calendar/describe";
import { formatRange } from "@/lib/promo-calendar/dates";
import { parseDate } from "@/lib/promo-calendar/lifecycle";
import { parseInZone } from "@/lib/promo-calendar/zone";
import type { Promotion, PromotionNotification, PromotionRule } from "@/lib/promotions/types";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");
const id = z.number().int().positive();
const ids = z.array(id).max(100);
const money = z.number().positive().max(1_000_000);
const percent = z.number().gt(0).lte(100);

const target = z
  .object({ categoryIds: ids.optional(), brandIds: ids.optional(), productIds: ids.optional() })
  .refine((t) => (t.categoryIds?.length ?? 0) + (t.brandIds?.length ?? 0) + (t.productIds?.length ?? 0) > 0, "Choose at least one category, brand or product");

export const rewardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent_off_order"), percent, minSpend: money.optional() }),
  z.object({ kind: z.literal("amount_off_order"), amount: money, minSpend: money.optional() }),
  z.object({ kind: z.literal("percent_off_items"), percent, target, minSpend: money.optional() }),
  z.object({ kind: z.literal("amount_off_items"), amount: money, target, minSpend: money.optional() }),
  z.object({ kind: z.literal("free_shipping"), minSpend: money.optional() }),
]);

export const createSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    displayName: z.string().trim().max(100).optional(),
    redemption: z.enum(["AUTOMATIC", "COUPON"]).default("AUTOMATIC"),
    couponCode: z.string().trim().regex(/^[A-Za-z0-9_-]{3,50}$/, "Coupon codes use letters, numbers, - and _").optional(),
    reward: rewardSchema,
    // Shown on the draft card only, e.g. "Winter category".
    targetLabel: z.string().trim().max(200).optional(),
    start: isoDate.nullable().default(null),
    end: isoDate.nullable().default(null),
    groupIds: ids.default([]),
    excludedGroupIds: ids.default([]),
    channelIds: ids.default([]),
    stackable: z.boolean().default(true),
    maxUses: z.number().int().positive().optional(),
    messages: z
      .object({ upsell: z.string().trim().max(200).optional(), eligible: z.string().trim().max(200).optional(), applied: z.string().trim().max(200).optional() })
      .optional(),
  })
  .refine((spec) => spec.redemption !== "COUPON" || Boolean(spec.couponCode), { message: "A coupon promotion needs a coupon code", path: ["couponCode"] })
  .refine((spec) => !spec.start || !spec.end || Date.parse(spec.end) > Date.parse(spec.start), { message: "The end must be after the start", path: ["end"] });

export const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().max(100).optional(),
    start: isoDate.nullable().optional(),
    end: isoDate.nullable().optional(),
    status: z.enum(["ENABLED", "DISABLED"]).optional(),
    groupIds: ids.optional(),
    excludedGroupIds: ids.optional(),
    stackable: z.boolean().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    percent: percent.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export const draftSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), spec: createSpecSchema }),
  z.object({ type: z.literal("update"), id, patch: patchSchema }),
]);

export type CreateSpec = z.output<typeof createSpecSchema>;
export type Patch = z.output<typeof patchSchema>;
export type Draft = z.output<typeof draftSchema>;

export interface DiffLine {
  label: string;
  before: string;
  after: string;
}

// What the draft card shows.
export interface DraftPreview {
  title: string;
  lines: DiffLine[];
  warnings: string[];
}

// BigCommerce examples use RFC 3339 with an explicit offset. Times with no
// offset ("2026-11-27T00:00") are read as the store's local time.
export function toBcDate(value: string | null | undefined, timeZone = "UTC"): string | null {
  return value ? parseInZone(value, timeZone).toISOString().replace(/\.\d{3}Z$/, "+00:00") : null;
}

function itemsMatcher(t: { categoryIds?: number[]; brandIds?: number[]; productIds?: number[] }) {
  const leaves = [
    t.categoryIds?.length ? { categories: t.categoryIds } : undefined,
    t.brandIds?.length ? { brands: t.brandIds } : undefined,
    t.productIds?.length ? { products: t.productIds } : undefined,
  ].filter((leaf): leaf is NonNullable<typeof leaf> => leaf !== undefined);

  return leaves.length === 1 ? leaves[0] : { or: leaves };
}

function compileRule(spec: CreateSpec): PromotionRule {
  const { reward } = spec;
  const condition = "minSpend" in reward && reward.minSpend ? { cart: { minimum_spend: String(reward.minSpend) } } : undefined;
  const discount = "percent" in reward ? { percentage_amount: String(reward.percent) } : "amount" in reward ? { fixed_amount: String(reward.amount) } : undefined;
  let action: PromotionRule["action"];

  switch (reward.kind) {
    case "percent_off_order":
    case "amount_off_order":
      action = { cart_value: { discount: discount! } };
      break;
    case "percent_off_items":
    case "amount_off_items":
      action = { cart_items: { discount: discount!, items: itemsMatcher(reward.target) } };
      break;
    case "free_shipping":
      action = { shipping: { free_shipping: true } };
      break;
  }

  return { action, ...(condition && { condition }), apply_once: true, stop: false };
}

function compileNotifications(messages: CreateSpec["messages"]): PromotionNotification[] | undefined {
  if (!messages) return undefined;

  const out: PromotionNotification[] = [];

  if (messages.upsell) out.push({ type: "UPSELL", content: messages.upsell, locations: ["HOME_PAGE", "PRODUCT_PAGE", "CART_PAGE"] });
  if (messages.eligible) out.push({ type: "ELIGIBLE", content: messages.eligible, locations: ["CART_PAGE"] });
  if (messages.applied) out.push({ type: "APPLIED", content: messages.applied, locations: ["CART_PAGE"] });

  return out.length > 0 ? out : undefined;
}

// New promotions are ALWAYS created disabled: a person turns them on after reviewing.
export function compileCreate(spec: CreateSpec, timeZone = "UTC"): Promotion {
  const notifications = compileNotifications(spec.messages);

  return {
    name: spec.name,
    ...(spec.displayName && { display_name: spec.displayName }),
    redemption_type: spec.redemption,
    status: "DISABLED",
    rules: [compileRule(spec)],
    ...((spec.groupIds.length > 0 || spec.excludedGroupIds.length > 0) && {
      customer: {
        ...(spec.groupIds.length > 0 && { group_ids: spec.groupIds }),
        ...(spec.excludedGroupIds.length > 0 && { excluded_group_ids: spec.excludedGroupIds }),
      },
    }),
    channels: spec.channelIds.map((channelId) => ({ id: channelId })),
    start_date: toBcDate(spec.start, timeZone),
    end_date: toBcDate(spec.end, timeZone),
    can_be_used_with_other_promotions: spec.stackable,
    ...(spec.maxUses && { max_uses: spec.maxUses }),
    ...(notifications && { notifications }),
  };
}

function setPercent(rule: PromotionRule, percentValue: number): PromotionRule {
  const value = String(percentValue);

  if (rule.action.cart_value?.discount.percentage_amount !== undefined) {
    return { ...rule, action: { ...rule.action, cart_value: { ...rule.action.cart_value, discount: { ...rule.action.cart_value.discount, percentage_amount: value } } } };
  }

  if (rule.action.cart_items?.discount.percentage_amount !== undefined) {
    return { ...rule, action: { ...rule.action, cart_items: { ...rule.action.cart_items, discount: { ...rule.action.cart_items.discount, percentage_amount: value } } } };
  }

  throw new Error("The percentage can only be changed on a simple percentage-off promotion.");
}

// Applies a patch to the CURRENT promotion, preserving every field it doesn't touch.
export function applyPatch(current: Promotion, patch: Patch, timeZone = "UTC"): Promotion {
  const next: Promotion = { ...current };

  if (patch.name !== undefined) next.name = patch.name;
  if (patch.displayName !== undefined) next.display_name = patch.displayName;
  if (patch.start !== undefined) next.start_date = toBcDate(patch.start, timeZone);
  if (patch.end !== undefined) next.end_date = toBcDate(patch.end, timeZone);
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.stackable !== undefined) next.can_be_used_with_other_promotions = patch.stackable;
  if (patch.maxUses !== undefined) next.max_uses = patch.maxUses ?? 0;

  if (patch.groupIds !== undefined || patch.excludedGroupIds !== undefined) {
    next.customer = { ...current.customer };

    if (patch.groupIds !== undefined) next.customer.group_ids = patch.groupIds;
    if (patch.excludedGroupIds !== undefined) next.customer.excluded_group_ids = patch.excludedGroupIds;
  }

  if (patch.percent !== undefined) {
    if (current.rules.length !== 1) throw new Error("The percentage can only be changed on a promotion with a single rule.");

    next.rules = [setPercent(current.rules[0], patch.percent)];
  }

  if (next.start_date && next.end_date && Date.parse(next.end_date) <= Date.parse(next.start_date)) {
    throw new Error("The end must be after the start.");
  }

  return next;
}

// A flat, human-readable summary of a promotion, used to diff before/after.
export function summarize(promotion: Promotion, groupNames: Map<number, string>, extras?: { targetLabel?: string; timeZone?: string }): Record<string, string> {
  const reward = describeDiscount(promotion);
  const upsell = promotion.notifications?.find((n) => n.type === "UPSELL")?.content;

  return {
    Name: promotion.display_name && promotion.display_name !== promotion.name ? `${promotion.display_name} (${promotion.name})` : promotion.name,
    Reward: extras?.targetLabel ? `${reward}: ${extras.targetLabel}` : reward,
    Minimum: promotion.rules.map((rule) => rule.condition?.cart?.minimum_spend).find(Boolean) ? `Spend ${promotion.rules.map((rule) => rule.condition?.cart?.minimum_spend).find(Boolean)}+` : "None",
    Runs: formatRange({ start: parseDate(promotion.start_date), end: parseDate(promotion.end_date) }, extras?.timeZone),
    Audience: describeAudience(toAudience(promotion), groupNames),
    Stacking: promotion.can_be_used_with_other_promotions === false ? "Cannot combine with other promotions" : "Can combine with other promotions",
    "Usage limit": promotion.max_uses ? `${promotion.max_uses} uses` : "None",
    "Banner message": upsell ?? "None",
    Status: promotion.status === "ENABLED" ? "Enabled" : "Disabled",
  };
}

export function diffSummaries(before: Record<string, string> | null, after: Record<string, string>): DiffLine[] {
  return Object.entries(after)
    .filter(([label, value]) => before === null || before[label] !== value)
    .map(([label, value]) => ({ label, before: before ? before[label] : "", after: value }));
}
