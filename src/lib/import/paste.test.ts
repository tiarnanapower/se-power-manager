import { describe, expect, it } from "vitest";
import { buildImportPrompt, parsePastedProducts } from "@/lib/import/paste";

describe("buildImportPrompt", () => {
  it("lists the pages and the count, and asks for JSON only", () => {
    const prompt = buildImportPrompt(["https://a.example/shoes", "https://b.example"], 12);

    expect(prompt).toContain("https://a.example/shoes");
    expect(prompt).toContain("https://b.example");
    expect(prompt).toContain("up to 12 real products");
    expect(prompt).toContain("Return ONLY a valid JSON array");
  });

  it("still gives a usable prompt with no addresses yet", () => {
    expect(buildImportPrompt([], 5)).toContain("https://your-customer-site.com");
  });
});

describe("parsePastedProducts", () => {
  const answer = [
    { name: "Trail Runner", price: "£1,089.50", sku: "TR-1", brand: "Acme", category: "Shoes > Running", description: "Light.", images: ["https://a.example/1.jpg", "not a url", "https://a.example/1.jpg"], url: "https://a.example/p/trail-runner" },
    { title: "Cap", price: 12, categories: ["Hats", "Summer"], image_url: "https://a.example/cap.jpg" },
  ];

  it("reads a plain array", () => {
    const { products, skipped } = parsePastedProducts(JSON.stringify(answer), "https://fallback.example/");

    expect(skipped).toBe(0);
    expect(products[0]).toMatchObject({ name: "Trail Runner", price: 1089.5, sku: "TR-1", brand: "Acme", category: "Shoes > Running", imageUrls: ["https://a.example/1.jpg"], sourceUrl: "https://a.example/p/trail-runner" });
    expect(products[1]).toMatchObject({ name: "Cap", price: 12, category: "Hats > Summer", imageUrls: ["https://a.example/cap.jpg"], sourceUrl: "https://fallback.example/" });
  });

  it("copes with code fences, chat text around the JSON and curly quotes", () => {
    const text = `Sure! Here you go:\n\n\`\`\`json\n${JSON.stringify(answer).replace(/"/g, "“").replace(/“([^“]*)“(\s*:)/g, '"$1"$2')}\n\`\`\`\nLet me know if you need more.`;
    const fixed = text.replace(/“/g, '"');

    expect(parsePastedProducts(fixed).products).toHaveLength(2);
  });

  it("accepts an object with a products list", () => {
    expect(parsePastedProducts(JSON.stringify({ products: answer })).products).toHaveLength(2);
  });

  it("skips entries without a name and duplicates, and counts them", () => {
    const { products, skipped } = parsePastedProducts(JSON.stringify([{ name: "A" }, { name: "a" }, { price: 3 }]));

    expect(products).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("explains what is wrong with unusable answers", () => {
    expect(() => parsePastedProducts("I couldn't open that site.")).toThrow("No JSON found");
    expect(() => parsePastedProducts('[{"name": "A",')).toThrow();
    expect(() => parsePastedProducts("[]")).toThrow("empty");
    expect(() => parsePastedProducts('[{"price": 4}]')).toThrow("product name");
  });
});
