import { describe, expect, it } from "vitest";
import { digestPage } from "@/lib/import/page-digest";
import { normaliseProducts } from "@/lib/import/scrape";
import { isPrivateAddress } from "@/lib/import/safe-fetch";

const html = `<html><head><title>Tee &amp; Co</title>
<meta property="og:image" content="/img/tee-big.jpg"><meta name="description" content="A soft tee">
<script type="application/ld+json">{"@type":"Product","name":"Tee","offers":{"price":"19.99"}}</script>
<script>var secret = 1;</script></head>
<body><h1>Tee</h1><p>Soft &pound;19.99</p>
<img src="/img/tee-1.jpg" srcset="/img/tee-s.jpg 300w, /img/tee-l.jpg 1200w"><img src="/assets/logo.png"><img src="data:image/png;base64,AAA"></body></html>`;

describe("digestPage", () => {
  const digest = digestPage(html, "https://shop.example/products/tee");

  it("keeps structured data, text and absolute image urls", () => {
    expect(digest.title).toBe("Tee & Co");
    expect(digest.meta["description"]).toBe("A soft tee");
    expect(digest.jsonLd).toHaveLength(1);
    expect(digest.text).toContain("Soft £19.99");
    expect(digest.text).not.toContain("secret");
    expect(digest.images.map((image) => image.url)).toEqual(["https://shop.example/img/tee-big.jpg", "https://shop.example/img/tee-l.jpg"]);
  });

  it("only keeps images that were on the page and normalises prices", () => {
    const products = normaliseProducts(
      JSON.stringify({ products: [
        { name: "Tee", price: "£1,019.50", images: [1, 99, "https://evil.example/x.jpg"] },
        { name: "tee", price: 5 },
        { name: "Cap", price: -3, sku: " C1 " },
      ] }),
      digest,
      10,
    );

    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ name: "Tee", price: 1019.5, imageUrls: ["https://shop.example/img/tee-l.jpg"] });
    expect(products[1]).toMatchObject({ name: "Cap", price: null, sku: "C1" });
  });

  it("rejects unreadable model output", () => {
    expect(() => normaliseProducts("not json", digest, 5)).toThrow();
  });
});

describe("image matching", () => {
  const listing = digestPage(
    `<a href="/p/red-hat"><img src="/m/1.jpg" alt="Red Hat"></a><a href="/p/blue-cap"><img src="/m/2.jpg" alt="Blue Cap"></a><img src="/m/3.jpg" alt="Green Scarf">`,
    "https://shop.example/",
  );

  it("records each image's link and alt text", () => {
    expect(listing.images[0]).toMatchObject({ alt: "Red Hat", href: "https://shop.example/p/red-hat" });
    expect(listing.images[2].href).toBeNull();
  });

  it("gives a product the image its link or alt text points to when the model left it bare", () => {
    const products = normaliseProducts(
      JSON.stringify({ products: [{ name: "Red Hat", images: [] }, { name: "Blue Cap", url: "https://shop.example/p/blue-cap" }, { name: "The Green Scarf (wool)", images: [] }, { name: "Unknown" }] }),
      listing,
      10,
    );

    expect(products.map((product) => product.imageUrls)).toEqual([["https://shop.example/m/1.jpg"], ["https://shop.example/m/2.jpg"], ["https://shop.example/m/3.jpg"], []]);
  });
});

describe("isPrivateAddress", () => {
  it("blocks internal ranges", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(address)).toBe(true);
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPrivateAddress(address)).toBe(false);
  });
});

import { toPackProduct } from "@/lib/import/to-pack";

describe("toPackProduct", () => {
  it("maps a reviewed product to a restorable pack product", () => {
    const pack = toPackProduct({ name: "Tee", price: 9.5, sku: "T1", brand: "Acme", category: "Clothing > T-Shirts", description: "Soft", imageUrls: ["https://a.example/1.jpg", "https://a.example/2.jpg"], sourceUrl: "https://a.example" });

    expect(pack.categoryPaths).toEqual(["Clothing > T-Shirts"]);
    expect(pack.raw).toMatchObject({ brandName: "Acme", fields: { price: 9.5, sku: "T1", type: "physical" } });
    expect((pack.raw.images as { isThumbnail: boolean }[]).map((image) => image.isThumbnail)).toEqual([true, false]);
  });
});
