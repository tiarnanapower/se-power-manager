import { afterEach, describe, expect, it, vi } from "vitest";
import { checkImageReachable } from "@/lib/catalog/images";

afterEach(() => vi.unstubAllGlobals());

const respondWith = (status: number) => vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));

describe("checkImageReachable", () => {
  it("accepts a live image and rejects one that is gone", async () => {
    respondWith(200);
    expect(await checkImageReachable("https://cdn.example/a.jpg")).toBe(true);

    respondWith(404);
    expect(await checkImageReachable("https://cdn.example/a.jpg")).toBe(false);
  });

  it("gives the benefit of the doubt when a CDN refuses HEAD requests or rate limits", async () => {
    for (const status of [403, 405, 429]) {
      respondWith(status);
      expect(await checkImageReachable("https://cdn.example/a.jpg")).toBe(true);
    }
  });

  it("treats network errors and bad URLs as gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await checkImageReachable("https://cdn.example/a.jpg")).toBe(false);
    expect(await checkImageReachable("not a url")).toBe(false);
  });

  it("never requests non-https or private-host URLs", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));

    vi.stubGlobal("fetch", fetchSpy);
    expect(await checkImageReachable("http://cdn.example/a.jpg")).toBe(false);
    expect(await checkImageReachable("https://localhost/a.jpg")).toBe(true);
    expect(await checkImageReachable("https://169.254.169.254/latest")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
