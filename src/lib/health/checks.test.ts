import { describe, expect, it } from "vitest";
import { evaluateHealth, type HealthProduct } from "@/lib/health/checks";

const good = (id: number, over: Partial<HealthProduct> = {}): HealthProduct => ({
  id, name: `Product ${id}`, sku: `SKU-${id}`, type: "physical", price: 10, description: "<p>A perfectly good description of the product.</p>", is_visible: true, brand_id: 1, categories: [5], inventory_level: 5, inventory_tracking: "product", page_title: "Title", meta_description: "Meta", primary_image: { url_thumbnail: "x" }, ...over,
});

const count = (report: ReturnType<typeof evaluateHealth>, id: string) => report.checks.find((check) => check.id === id)?.count;

describe("evaluateHealth", () => {
  it("scores a clean catalog at 100", () => {
    const report = evaluateHealth([good(1), good(2)]);

    expect(report.score).toBe(100);
    expect(report.checks.every((check) => check.count === 0)).toBe(true);
  });

  it("flags each kind of problem", () => {
    const report = evaluateHealth([
      good(1, { primary_image: null }),
      good(2, { description: "<p> </p>" }),
      good(3, { price: 0 }),
      good(4, { categories: [] }),
      good(5, { sku: "" }),
      good(6, { inventory_level: 0 }),
      good(7, { is_visible: false, brand_id: 0, page_title: "", meta_description: "" }),
      good(8, { sku: "dup" }),
      good(9, { sku: "DUP", name: "Product 1" }),
    ]);

    expect(count(report, "no-image")).toBe(1);
    expect(count(report, "no-description")).toBe(1);
    expect(count(report, "bad-price")).toBe(1);
    expect(count(report, "no-category")).toBe(1);
    expect(count(report, "no-sku")).toBe(1);
    expect(count(report, "out-of-stock")).toBe(1);
    expect(count(report, "hidden")).toBe(1);
    expect(count(report, "no-brand")).toBe(1);
    expect(count(report, "no-seo")).toBe(1);
    expect(count(report, "duplicate-sku")).toBe(2);
    expect(count(report, "duplicate-name")).toBe(2);
  });

  it("leaves info findings out of the score", () => {
    const report = evaluateHealth([good(1, { is_visible: false, brand_id: 0 }), good(2)]);

    expect(report.score).toBe(100);
  });

  it("counts a product once however many problems it has", () => {
    const report = evaluateHealth([good(1, { primary_image: null, price: 0, description: "" }), good(2), good(3), good(4)]);

    expect(report.score).toBe(75);
  });

  it("checks channels only when assignments are known", () => {
    expect(count(evaluateHealth([good(1), good(2)]), "no-channel")).toBe(0);
    expect(count(evaluateHealth([good(1), good(2)], new Set([1])), "no-channel")).toBe(1);
  });

  it("ignores stock on products that don't track it", () => {
    expect(count(evaluateHealth([good(1, { inventory_tracking: "none", inventory_level: 0 })]), "out-of-stock")).toBe(0);
  });
});
