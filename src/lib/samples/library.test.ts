import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSamplesCache } from "@/lib/samples/github";
import { chunkFor, chunkName, isImageFile, isSlug, isVersion, nextVersion, slugify, SAMPLE_FORMAT_VERSION } from "@/lib/samples/format";
import { getHistory, getImage, getIndex, getProducts, getVersion } from "@/lib/samples/library";

const files: Record<string, unknown> = {};
const requested: string[] = [];

function fakeGitHub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);

      requested.push(url);

      if (url.includes("/commits?")) return new Response(JSON.stringify([{ sha: "abcdef1234", html_url: "https://github.com/x/y/commit/abcdef1", commit: { message: "Add v2\n\nmore", author: { name: "Tia", date: "2026-11-01T10:00:00Z" } } }]), { status: 200 });

      const match = url.match(/\/contents\/([^?]+)\?/);
      const path = match ? decodeURIComponent(match[1]) : "";
      const body = files[path];

      if (body === undefined) return new Response("{}", { status: 404 });

      return new Response(body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body), { status: 200 });
    }),
  );
}

beforeEach(() => {
  resetSamplesCache();
  requested.length = 0;
  for (const key of Object.keys(files)) delete files[key];
  fakeGitHub();
});

afterEach(() => vi.unstubAllGlobals());

const meta = { slug: "outdoor", name: "Outdoor", description: "", tags: [], latest: "v2", defaultLanguage: "en", languages: ["en"], versions: [{ version: "v1", date: "", notes: "", formatVersion: 1, sections: ["catalog"], products: 150 }, { version: "v2", date: "", notes: "", formatVersion: 1, sections: ["catalog"], products: 150 }] };
const product = (n: number) => ({ name: `P${n}`, sku: `S${n}`, price: 1, description: null, imageUrls: [], categoryPaths: [], raw: {} });

describe("sample format helpers", () => {
  it("finds a product's chunk", () => {
    expect(chunkFor(0)).toEqual({ file: 0, offset: 0 });
    expect(chunkFor(250)).toEqual({ file: 2, offset: 50 });
    expect(chunkName(2)).toBe("products-0003.json");
  });

  it("validates names that end up in paths", () => {
    expect(isSlug("outdoor-retailer")).toBe(true);
    expect(isSlug("../etc")).toBe(false);
    expect(isSlug("Outdoor")).toBe(false);
    expect(isVersion("v12")).toBe(true);
    expect(isVersion("latest")).toBe(false);
    expect(isImageFile(`${"a".repeat(64)}.jpg`)).toBe(true);
    expect(isImageFile("../x.jpg")).toBe(false);
  });

  it("makes slugs and the next version", () => {
    expect(slugify("Outdoor Retailer (UK)")).toBe("outdoor-retailer-uk");
    expect(nextVersion([])).toBe("v1");
    expect(nextVersion(["v1", "v3"])).toBe("v4");
  });
});

describe("samples library", () => {
  it("treats a repo with no index as an empty library", async () => {
    expect(await getIndex()).toEqual({ format: 1, samples: [] });
  });

  it("reads a version with its catalog", async () => {
    files["samples/outdoor/sample.json"] = meta;
    files["samples/outdoor/v2/manifest.json"] = { formatVersion: 1, slug: "outdoor", version: "v2", capturedAt: "", source: { storeName: null }, defaultLanguage: "en", sections: { catalog: { file: "catalog.json" } }, images: 0 };
    files["samples/outdoor/v2/catalog.json"] = { categories: [], brands: [], products: [], chunks: [] };

    const bundle = await getVersion("outdoor");

    expect(bundle.version).toBe("v2");
    expect(bundle.catalog?.products).toEqual([]);
  });

  it("refuses a sample written in a newer format", async () => {
    files["samples/outdoor/sample.json"] = meta;
    files["samples/outdoor/v2/manifest.json"] = { formatVersion: SAMPLE_FORMAT_VERSION + 1, sections: {} };

    await expect(getVersion("outdoor")).rejects.toThrow("Update the app");
  });

  it("rejects versions the sample doesn't have, and path tricks", async () => {
    files["samples/outdoor/sample.json"] = meta;

    await expect(getVersion("outdoor", "v9")).rejects.toThrow();
    await expect(getVersion("../../etc")).rejects.toThrow();
    await expect(getImage("../secret.jpg")).rejects.toThrow();
  });

  it("reads products across chunk boundaries", async () => {
    files["samples/outdoor/v2/catalog/products-0001.json"] = Array.from({ length: 100 }, (_, i) => product(i));
    files["samples/outdoor/v2/catalog/products-0002.json"] = Array.from({ length: 50 }, (_, i) => product(100 + i));

    const slice = await getProducts("outdoor", "v2", 95, 10);

    expect(slice.map((entry) => entry.name)).toEqual(["P95", "P96", "P97", "P98", "P99", "P100", "P101", "P102", "P103", "P104"]);
  });

  it("caches files so browsing doesn't spend the GitHub rate limit", async () => {
    files["samples/outdoor/sample.json"] = meta;

    await getVersion("outdoor", "v1").catch(() => undefined);
    await getVersion("outdoor", "v1").catch(() => undefined);

    expect(requested.filter((url) => url.includes("sample.json"))).toHaveLength(1);
  });

  it("serves image bytes and lists history", async () => {
    const file = `${"b".repeat(64)}.jpg`;

    files[`images/${file}`] = new Uint8Array([1, 2, 3]);

    expect([...(await getImage(file))]).toEqual([1, 2, 3]);
    expect(await getHistory("outdoor")).toEqual([{ sha: "abcdef1", message: "Add v2", author: "Tia", date: "2026-11-01T10:00:00Z", url: "https://github.com/x/y/commit/abcdef1" }]);
  });
});
