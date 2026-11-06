// Pack images are stored as URLs on the source store's CDN. BigCommerce deletes
// a product's images when the product is deleted, so a pack saved before a
// clear can point at images that no longer exist. Creating a product with a
// dead image URL fails (or stalls while BigCommerce tries to fetch it), so the
// restore checks each URL first and leaves the dead ones out.
import type { PackProduct } from "@/lib/app-data/types";
import type { PackProductRaw } from "@/lib/catalog/pack-mapper";

export type ImageCheck = (url: string) => Promise<boolean>;

// Copies an image to durable public storage and returns the copy's URL, or null
// if it couldn't (gone, too large, not an image, storage error).
export interface ImageStore {
  configured(): boolean;
  preserve(url: string): Promise<string | null>;
}

export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

// True for URLs already copied to durable storage.
export function isBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

// Every image URL a pack product refers to: its pictures and its variants'.
export function collectImageUrls(product: PackProduct): string[] {
  const raw = product.raw as Partial<PackProductRaw>;

  return [...new Set([...(raw.images ?? []).map((image) => image.url), ...(raw.variants ?? []).flatMap((variant) => (variant.image_url ? [variant.image_url] : [])), ...product.imageUrls])];
}

// Returns the product with each URL swapped for its replacement, where one exists.
export function rewriteProductImages(product: PackProduct, replacements: Map<string, string>): PackProduct {
  if (replacements.size === 0) return product;

  const raw = product.raw as Partial<PackProductRaw>;
  const swap = (url: string) => replacements.get(url) ?? url;

  return {
    ...product,
    imageUrls: product.imageUrls.map(swap),
    raw: {
      ...product.raw,
      images: (raw.images ?? []).map((image) => ({ ...image, url: swap(image.url) })),
      variants: (raw.variants ?? []).map((variant) => (variant.image_url ? { ...variant, image_url: swap(variant.image_url) } : variant)),
    },
  };
}

const CHECK_TIMEOUT_MS = 6000;

function isPrivateHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || /^[\d.]+$/.test(hostname) || hostname.includes(":");
}

// True when the URL looks fetchable. Anything we can't judge (a CDN that
// rejects HEAD requests) counts as fine, so this only removes URLs that are
// clearly gone. Only public https URLs are ever requested.
export const checkImageReachable: ImageCheck = async (url) => {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" || isPrivateHost(parsed.hostname)) return parsed.protocol === "https:";

  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), redirect: "follow" });

    if (response.ok) return true;

    return response.status === 403 || response.status === 405 || response.status === 429;
  } catch {
    return false;
  }
};

export interface ImageFilterResult {
  product: PackProduct;
  // Image URLs dropped because they no longer exist.
  missing: number;
}

// Returns the product with dead product and variant images removed.
export async function dropDeadImages(product: PackProduct, check: ImageCheck): Promise<ImageFilterResult> {
  const raw = product.raw as Partial<PackProductRaw>;
  const urls = new Set<string>([...(raw.images ?? []).map((image) => image.url), ...(raw.variants ?? []).flatMap((variant) => (variant.image_url ? [variant.image_url] : []))]);

  if (urls.size === 0) return { product, missing: 0 };

  const alive = new Set<string>();

  await Promise.all([...urls].map(async (url) => ((await check(url)) ? alive.add(url) : undefined)));

  const missing = urls.size - alive.size;

  if (missing === 0) return { product, missing: 0 };

  const images = (raw.images ?? []).filter((image) => alive.has(image.url));
  // Keep a thumbnail if any image survives.
  const hasThumbnail = images.some((image) => image.isThumbnail);
  const fixedImages = images.length && !hasThumbnail ? images.map((image, index) => (index === 0 ? { ...image, isThumbnail: true } : image)) : images;
  const variants = (raw.variants ?? []).map((variant) => {
    if (!variant.image_url || alive.has(variant.image_url)) return variant;

    const { image_url: _removed, ...rest } = variant;

    return rest;
  });

  return { product: { ...product, imageUrls: fixedImages.map((image) => image.url), raw: { ...product.raw, images: fixedImages, variants } }, missing };
}

export function withoutImages(product: PackProduct): PackProduct {
  const raw = product.raw as Partial<PackProductRaw>;

  return { ...product, imageUrls: [], raw: { ...product.raw, images: [], variants: (raw.variants ?? []).map(({ image_url: _removed, ...rest }) => rest) } };
}

export function looksLikeImageError(reason: string): boolean {
  return /image/i.test(reason);
}
