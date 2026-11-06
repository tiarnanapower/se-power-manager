import { describe, expect, it } from "vitest";
import { applyPatch, compileCreate, createSpecSchema, diffSummaries, draftSchema, patchSchema, summarize } from "@/lib/copilot/draft-spec";
import type { Promotion } from "@/lib/promotions/types";

const names = new Map([[1, "VIP"]]);

describe("createSpecSchema", () => {
  it("applies defaults and validates", () => {
    const spec = createSpecSchema.parse({ name: "BF", reward: { kind: "percent_off_order", percent: 15 } });

    expect(spec.redemption).toBe("AUTOMATIC");
    expect(spec.groupIds).toEqual([]);
    expect(spec.stackable).toBe(true);
  });

  it("rejects bad input", () => {
    expect(createSpecSchema.safeParse({ name: "x", reward: { kind: "percent_off_order", percent: 0 } }).success).toBe(false);
    expect(createSpecSchema.safeParse({ name: "x", reward: { kind: "percent_off_order", percent: 10 }, redemption: "COUPON" }).success).toBe(false);
    expect(createSpecSchema.safeParse({ name: "x", reward: { kind: "percent_off_items", percent: 10, target: {} } }).success).toBe(false);
    expect(createSpecSchema.safeParse({ name: "x", reward: { kind: "free_shipping" }, start: "2026-11-10T00:00:00Z", end: "2026-11-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("compileCreate", () => {
  it("always creates disabled and compiles an order discount with a minimum", () => {
    const spec = createSpecSchema.parse({
      name: "BF",
      reward: { kind: "percent_off_order", percent: 15, minSpend: 100 },
      start: "2026-11-27T00:00:00Z",
      end: "2026-11-30T23:59:59Z",
      groupIds: [1],
      messages: { upsell: "15% off this weekend" },
    });
    const promotion = compileCreate(spec);

    expect(promotion.status).toBe("DISABLED");
    expect(promotion.start_date).toBe("2026-11-27T00:00:00+00:00");
    expect(promotion.customer?.group_ids).toEqual([1]);
    expect(promotion.rules[0].action.cart_value?.discount.percentage_amount).toBe("15");
    expect(promotion.rules[0].condition?.cart?.minimum_spend).toBe("100");
    expect(promotion.notifications?.[0].type).toBe("UPSELL");
  });

  it("builds an OR matcher when several item targets are given, a leaf for one", () => {
    const one = compileCreate(createSpecSchema.parse({ name: "a", reward: { kind: "percent_off_items", percent: 10, target: { categoryIds: [5] } } }));
    const many = compileCreate(createSpecSchema.parse({ name: "b", reward: { kind: "percent_off_items", percent: 10, target: { categoryIds: [5], brandIds: [2] } } }));

    expect(one.rules[0].action.cart_items?.items).toEqual({ categories: [5] });
    expect(many.rules[0].action.cart_items?.items).toEqual({ or: [{ categories: [5] }, { brands: [2] }] });
  });

  it("compiles free shipping", () => {
    expect(compileCreate(createSpecSchema.parse({ name: "s", reward: { kind: "free_shipping", minSpend: 75 } })).rules[0].action.shipping?.free_shipping).toBe(true);
  });
});

describe("applyPatch and diff", () => {
  const current: Promotion = {
    id: 9,
    name: "Sale",
    redemption_type: "AUTOMATIC",
    status: "DISABLED",
    rules: [{ action: { cart_value: { discount: { percentage_amount: "10" } } }, stop: false }],
    start_date: "2026-11-01T00:00:00+00:00",
    end_date: "2026-11-05T00:00:00+00:00",
    customData: { keep: true },
  };

  it("changes only what is patched and keeps unknown fields", () => {
    const next = applyPatch(current, { percent: 20, end: "2026-11-08T00:00:00Z" });

    expect(next.rules[0].action.cart_value?.discount.percentage_amount).toBe("20");
    expect(next.end_date).toBe("2026-11-08T00:00:00+00:00");
    expect(next.customData).toEqual({ keep: true });
    expect(next.name).toBe("Sale");
  });

  it("rejects an end before the start and percent changes on complex promotions", () => {
    expect(() => applyPatch(current, { end: "2026-10-01T00:00:00Z" })).toThrow();
    expect(() => applyPatch({ ...current, rules: [...current.rules, ...current.rules] }, { percent: 5 })).toThrow();
  });

  it("diffs only the changed fields", () => {
    const next = applyPatch(current, { percent: 20 });
    const lines = diffSummaries(summarize(current, names), summarize(next, names));

    expect(lines.map((line) => line.label)).toEqual(["Reward"]);
    expect(lines[0].before).toBe("10% off order");
    expect(lines[0].after).toBe("20% off order");
  });
});

describe("schemas", () => {
  it("requires a non-empty patch and a valid draft shape", () => {
    expect(patchSchema.safeParse({}).success).toBe(false);
    expect(draftSchema.safeParse({ type: "update", id: 3, patch: { status: "ENABLED" } }).success).toBe(true);
    expect(draftSchema.safeParse({ type: "delete", id: 3 }).success).toBe(false);
  });
});
