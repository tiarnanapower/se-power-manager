import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PackProduct } from "@/lib/app-data/types";
import { assembleSample } from "@/lib/samples/assemble";
import { openBundle } from "@/lib/samples/bundle";
import { createZip } from "@/lib/samples/zip";
import { readZip } from "@/lib/samples/zip-read";

const product = (name: string): PackProduct => ({
  name, sku: name.toUpperCase(), price: 5, description: null, imageUrls: [], categoryPaths: ["Camping"],
  raw: { brandName: null, images: [{ url: "https://x/a.png", isThumbnail: true, sortOrder: 0, description: "" }], variants: [], customFields: [], modifiers: [], bulkPricingRules: [], videos: [], fields: {}, customUrl: null },
});
const sha256 = async (bytes: Uint8Array) => (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
const build = () => assembleSample(
  { products: [product("Tent"), product("Boot")], categoryPaths: ["Camping"], brands: [], sections: { shipping: { data: { zones: [] }, warnings: [] } } },
  { name: "Snap", readExisting: async () => undefined, fetchImage: async () => ({ bytes: new TextEncoder().encode("pixels"), mime: "image/png" }), sha256 },
);

describe("an uploaded snapshot", () => {
  it("round-trips through our own zip", async () => {
    const files = await readZip(createZip((await build()).files));
    const { samples, problems } = openBundle(files);

    expect(problems).toEqual([]);
    expect(samples).toHaveLength(1);

    const [sample] = samples;

    expect([sample.slug, sample.version, sample.name]).toEqual(["snap", "v1", "Snap"]);
    expect(sample.catalog?.products.map((entry) => entry.name)).toEqual(["Tent", "Boot"]);
    expect(sample.products(1, 5).map((entry) => entry.name)).toEqual(["Boot"]);
    expect(sample.product(0)?.name).toBe("Tent");
    expect(sample.product(9)).toBeUndefined();
    expect(Object.keys(sample.manifest.sections)).toEqual(["catalog", "shipping"]);
    expect(sample.section("shipping.json")).toEqual({ zones: [] });

    const file = sample.catalog!.products[0].image!;

    expect(new TextDecoder().decode(sample.image(file))).toBe("pixels");
    expect(sample.image("../../etc/passwd")).toBeUndefined();
  });

  it("reads a zip made by the system zip tool (deflated, inside a wrapper folder)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));

    for (const [path, contents] of (await build()).files) {
      const target = join(dir, "wrapper", path);

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }

    execFileSync("zip", ["-qr", join(dir, "out.zip"), "wrapper"], { cwd: dir });

    const { samples } = openBundle(await readZip(new Uint8Array(readFileSync(join(dir, "out.zip")))));

    expect(samples.map((entry) => entry.slug)).toEqual(["snap"]);
    expect(samples[0].products(0, 10)).toHaveLength(2);
  });

  it("opens a single version folder on its own", async () => {
    const all = (await build()).files;
    const files = new Map<string, Uint8Array>();

    for (const [path, contents] of all) {
      if (path.startsWith("samples/snap/v1/")) files.set(`v1/${path.slice("samples/snap/v1/".length)}`, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
      else if (path.startsWith("images/")) files.set(`v1/${path}`, contents as Uint8Array);
    }

    const { samples } = openBundle(files);

    expect(samples).toHaveLength(1);
    expect(samples[0].image(samples[0].catalog!.products[0].image!)).toBeDefined();
  });

  it("explains a file that isn't a snapshot or a zip", async () => {
    await expect(readZip(new TextEncoder().encode("hello"))).rejects.toThrow("zip");
    expect(openBundle(new Map([["notes.txt", new TextEncoder().encode("hi")]])).samples).toEqual([]);
  });
});
