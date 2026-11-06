// A small, precomputed summary of what is inside a pack, so a pack can be shown
// as a card without loading its products. Computed once when the pack is saved.
import type { PackPreview, PackProduct } from "@/lib/app-data/types";

export const PREVIEW_IMAGES = 4;
const PREVIEW_CATEGORIES = 3;
const PREVIEW_NAMES = 3;

export const EMPTY_PREVIEW: PackPreview = { images: [], categories: [], names: [] };

export function buildPackPreview(products: PackProduct[]): PackPreview {
  // Spread the image picks across the whole pack so the card shows variety
  // rather than the first few (often near-identical) products.
  const withImages = products.filter((product) => product.imageUrls.length > 0);
  const step = Math.max(1, Math.floor(withImages.length / PREVIEW_IMAGES));
  const images: string[] = [];

  for (let index = 0; index < withImages.length && images.length < PREVIEW_IMAGES; index += step) {
    const url = withImages[index].imageUrls[0];

    if (!images.includes(url)) images.push(url);
  }

  // Top-level category names, most common first.
  const counts = new Map<string, number>();

  for (const product of products) {
    for (const path of product.categoryPaths) {
      const top = path.split(" > ")[0]?.trim();

      if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
    }
  }

  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PREVIEW_CATEGORIES).map(([name]) => name);

  return { images, categories, names: products.slice(0, PREVIEW_NAMES).map((product) => product.name) };
}

// Tolerant of whatever is in the database column (null for packs saved before
// previews existed, or malformed JSON).
export function parsePreview(raw: unknown): PackPreview {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = (input: unknown) => (Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : []);

    if (!value || typeof value !== "object") return EMPTY_PREVIEW;

    const record = value as Record<string, unknown>;

    return { images: list(record.images), categories: list(record.categories), names: list(record.names) };
  } catch {
    return EMPTY_PREVIEW;
  }
}
