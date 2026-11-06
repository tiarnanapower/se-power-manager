// Turns reviewed scrape results into pack products, so pushing an import to a
// store reuses the restore path (categories and brands found or created,
// dead images dropped, demo products tracked, activity logged).
import type { PackProduct } from "@/lib/app-data/types";
import { CATEGORY_SEPARATOR } from "@/lib/catalog/pack-mapper";
import type { ScrapedProduct } from "@/lib/import/scrape";

export function toPackProduct(product: ScrapedProduct): PackProduct {
  const category = product.category?.split(/\s*[>/›»]\s*/).map((part) => part.trim()).filter(Boolean).join(CATEGORY_SEPARATOR);
  const fields: Record<string, unknown> = { type: "physical", weight: 0, is_visible: true };

  if (product.price !== null) fields.price = product.price;
  if (product.sku) fields.sku = product.sku;
  if (product.description) fields.description = product.description;

  return {
    name: product.name,
    sku: product.sku,
    price: product.price,
    description: product.description || null,
    imageUrls: product.imageUrls,
    categoryPaths: category ? [category] : [],
    raw: {
      fields,
      brandName: product.brand,
      variants: [],
      customFields: [],
      images: product.imageUrls.map((url, index) => ({ url, isThumbnail: index === 0, sortOrder: index, description: product.name })),
      bulkPricingRules: [],
      videos: [],
      modifiers: [],
      customUrl: null,
    },
  };
}
