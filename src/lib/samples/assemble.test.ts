import { describe, expect, it } from "vitest";
import type { PackProduct } from "@/lib/app-data/types";
import { assembleSample } from "@/lib/samples/assemble";
import type { SampleCatalogFile, SampleIndex, SampleMeta } from "@/lib/samples/format";

const product = (name: string, url: string, categoryPaths: string[]): PackProduct => ({
  name,
  sku: name.toUpperCase(),
  price: 10,
  description: null,
  imageUrls: [url],
  categoryPaths,
  raw: { brandName: "Acme", images: [{ url, isThumbnail: true, sortOrder: 0, description: "" }], variants: [], customFields: [], modifiers: [], bulkPricingRules: [], videos: [], fields: {}, customUrl: null },
});

const sha256 = async (bytes: Uint8Array) => (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
const fetchImage = async (url: string) => (url.includes("dead") ? undefined : { bytes: new TextEncoder().encode(`bytes of ${url}`), mime: "image/png" });

describe("assembleSample (a saved pack as sample files)", () => {
  it("writes the repo layout, with pictures stored once by hash", async () => {
    const result = await assembleSample(
      { products: [product("Tent", "https://x/a.png", ["Camping"]), product("Tent 2", "https://x/a.png", ["Camping"]), product("Boot", "https://x/dead.png", [])], categoryPaths: ["Camping"], brands: ["Acme"] },
      { name: "My Pack", readExisting: async () => undefined, fetchImage, sha256, now: () => new Date("2026-11-11T09:00:00Z") },
    );

    expect(result.slug).toBe("my-pack");
    expect(result.version).toBe("v1");
    expect([...result.files.keys()].filter((path) => path.startsWith("images/"))).toHaveLength(1);
    expect(result.warnings).toEqual(["Boot: couldn't download https://x/dead.png"]);

    const catalog = JSON.parse(result.files.get("samples/my-pack/v1/catalog.json") as string) as SampleCatalogFile;

    expect(catalog.products.map((entry) => entry.name)).toEqual(["Tent", "Tent 2", "Boot"]);
    expect(catalog.brands).toEqual(["Acme"]);
  });

  it("adds the next version to a sample already in the repo", async () => {
    const first = await assembleSample({ products: [product("Tent", "https://x/a.png", [])], categoryPaths: [], brands: [] }, { name: "Pack", readExisting: async () => undefined, fetchImage, sha256 });
    const existing: Record<string, string> = { "samples/pack/sample.json": first.files.get("samples/pack/sample.json") as string, "catalog.json": first.files.get("catalog.json") as string };
    const second = await assembleSample({ products: [product("Tent", "https://x/a.png", [])], categoryPaths: [], brands: [] }, { name: "Pack", notes: "Added a tent", readExisting: async (path) => existing[path], fetchImage, sha256 });
    const meta = JSON.parse(second.files.get("samples/pack/sample.json") as string) as SampleMeta;
    const index = JSON.parse(second.files.get("catalog.json") as string) as SampleIndex;

    expect(second.version).toBe("v2");
    expect(meta.versions.map((entry) => entry.version)).toEqual(["v1", "v2"]);
    expect(index.samples).toHaveLength(1);
    expect(index.samples[0].latest).toBe("v2");
  });
});
