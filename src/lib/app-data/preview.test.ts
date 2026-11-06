import { describe, expect, it } from "vitest";
import { buildPackPreview, EMPTY_PREVIEW, parsePreview } from "@/lib/app-data/preview";
import type { PackProduct } from "@/lib/app-data/types";

const product = (name: string, imageUrls: string[] = [], categoryPaths: string[] = []): PackProduct => ({ name, sku: null, price: 1, description: null, imageUrls, categoryPaths, raw: {} });

describe("buildPackPreview", () => {
  it("picks up to four images spread across the pack, skipping products without one", () => {
    const products = Array.from({ length: 20 }, (_, i) => product(`P${i}`, i % 2 === 0 ? [`img${i}.jpg`] : []));
    const { images } = buildPackPreview(products);

    expect(images).toHaveLength(4);
    expect(new Set(images).size).toBe(4);
    // Not just the first four products' images.
    expect(images.some((url) => url !== "img0.jpg" && url !== "img2.jpg" && url !== "img4.jpg" && url !== "img6.jpg")).toBe(true);
  });

  it("uses what it has when there are fewer than four images, and none for an image-less pack", () => {
    expect(buildPackPreview([product("A", ["a.jpg"]), product("B")]).images).toEqual(["a.jpg"]);
    expect(buildPackPreview([product("A"), product("B")]).images).toEqual([]);
  });

  it("lists the most common top-level categories and the first names", () => {
    const preview = buildPackPreview([
      product("Tent", [], ["Outdoor > Tents"]),
      product("Stove", [], ["Outdoor > Cooking", "Kitchen"]),
      product("Pan", [], ["Kitchen > Pans"]),
      product("Hat", [], ["Apparel"]),
      product("Tee"),
    ]);

    expect(preview.categories).toEqual(["Kitchen", "Outdoor", "Apparel"]);
    expect(preview.names).toEqual(["Tent", "Stove", "Pan"]);
  });

  it("handles an empty pack", () => {
    expect(buildPackPreview([])).toEqual(EMPTY_PREVIEW);
  });
});

describe("parsePreview", () => {
  it("accepts JSON text or an object, and falls back to empty on anything else", () => {
    const value = { images: ["a"], categories: ["c"], names: ["n"] };

    expect(parsePreview(JSON.stringify(value))).toEqual(value);
    expect(parsePreview(value)).toEqual(value);
    expect(parsePreview(null)).toEqual(EMPTY_PREVIEW);
    expect(parsePreview("{not json")).toEqual(EMPTY_PREVIEW);
    expect(parsePreview({ images: "x", names: [1, "ok"] })).toEqual({ images: [], categories: [], names: ["ok"] });
  });
});
