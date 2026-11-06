import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ head: vi.fn(), put: vi.fn() }));

vi.mock("@vercel/blob", () => blob);

import { blobImageStore } from "@/lib/catalog/image-store";

const bytes = Buffer.from("fake-image-bytes");
const hash = createHash("sha256").update(bytes).digest("hex");

function image(init: { status?: number; type?: string; length?: string; body?: Buffer } = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(init.body ?? bytes), { status: init.status ?? 200, headers: { "content-type": init.type ?? "image/jpeg", ...(init.length ? { "content-length": init.length } : {}) } })));
}

beforeEach(() => {
  blob.head.mockReset().mockRejectedValue(new Error("not found"));
  blob.put.mockReset().mockImplementation(async (pathname: string) => ({ url: `https://s1.public.blob.vercel-storage.com/${pathname}` }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("blobImageStore", () => {
  it("is configured only when a Blob token is set", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(blobImageStore.configured()).toBe(false);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "x");
    expect(blobImageStore.configured()).toBe(true);
  });

  it("downloads an image and stores it under a name derived from its content", async () => {
    image();

    const url = await blobImageStore.preserve("https://cdn.example/a.jpg");

    expect(url).toBe(`https://s1.public.blob.vercel-storage.com/pack-images/${hash}.jpg`);
    expect(blob.put).toHaveBeenCalledWith(`pack-images/${hash}.jpg`, bytes, expect.objectContaining({ access: "public", addRandomSuffix: false, contentType: "image/jpeg" }));
  });

  it("reuses an identical image that is already stored instead of uploading it again", async () => {
    image();
    blob.head.mockResolvedValue({ url: "https://s1.public.blob.vercel-storage.com/existing.jpg" });

    expect(await blobImageStore.preserve("https://cdn.example/a.jpg")).toBe("https://s1.public.blob.vercel-storage.com/existing.jpg");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("copes with content types that carry parameters", async () => {
    image({ type: "image/png; charset=binary" });

    expect(await blobImageStore.preserve("https://cdn.example/a")).toContain(`${hash}.png`);
  });

  it("returns null for anything that isn't a downloadable, reasonably sized image", async () => {
    image({ status: 404 });
    expect(await blobImageStore.preserve("https://cdn.example/gone.jpg")).toBeNull();

    image({ type: "text/html" });
    expect(await blobImageStore.preserve("https://cdn.example/page")).toBeNull();

    image({ length: String(11 * 1024 * 1024) });
    expect(await blobImageStore.preserve("https://cdn.example/huge.jpg")).toBeNull();

    image({ body: Buffer.alloc(0) });
    expect(await blobImageStore.preserve("https://cdn.example/empty.jpg")).toBeNull();

    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns null when the download or the upload fails, instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await blobImageStore.preserve("https://cdn.example/a.jpg")).toBeNull();

    image();
    blob.put.mockRejectedValue(new Error("store suspended"));
    expect(await blobImageStore.preserve("https://cdn.example/a.jpg")).toBeNull();
  });

  it("never fetches non-https or private-network URLs", async () => {
    image();

    for (const url of ["http://cdn.example/a.jpg", "https://localhost/a.jpg", "https://169.254.169.254/a.jpg", "https://[::1]/a.jpg", "file:///etc/passwd", "nonsense"]) {
      expect(await blobImageStore.preserve(url)).toBeNull();
    }

    expect(fetch).not.toHaveBeenCalled();
  });
});
