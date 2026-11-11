// Converts between a BigCommerce product and the store-agnostic pack shape.
// Store-specific ids (product, brand, category, tax class) are never copied;
// brands and categories travel by name and are found or created on restore.
import type { PackProduct } from "@/lib/app-data/types";
import type { BcProduct, BcVariant } from "@/lib/catalog/types";

export const CATEGORY_SEPARATOR = " > ";

// Plain product fields safe to copy between stores.
const COPIED_FIELDS = [
  "type", "sku", "description", "weight", "width", "depth", "height", "price", "cost_price", "retail_price",
  "sale_price", "map_price", "inventory_level", "inventory_warning_level", "inventory_tracking", "is_visible",
  "is_featured", "warranty", "bin_picking_number", "upc", "mpn", "gtin", "search_keywords", "availability",
  "availability_description", "condition", "is_condition_shown", "order_quantity_minimum", "order_quantity_maximum",
  "page_title", "meta_keywords", "meta_description", "is_free_shipping", "fixed_cost_shipping_price",
  "is_preorder_only", "preorder_message", "is_price_hidden", "price_hidden_label", "sort_order",
  "open_graph_type", "open_graph_title", "open_graph_description", "open_graph_use_meta_description",
  "open_graph_use_product_name", "product_tax_code",
] as const;

const VARIANT_FIELDS = ["sku", "price", "sale_price", "retail_price", "weight", "width", "height", "depth", "inventory_level", "is_free_shipping", "purchasing_disabled", "image_url", "cost_price", "map_price", "mpn", "upc", "gtin", "bin_picking_number", "inventory_warning_level"] as const;

export interface MapContext {
  // product id -> how to find that product again in another store (for pick lists)
  productRefs?: Map<number, ProductRef>;
  // category id -> "Parent > Child"
  categoryPaths: Map<number, string>;
  // brand id -> name
  brandNames: Map<number, string>;
}

// A product other products point at (pick lists), found again by SKU, else name.
export interface ProductRef {
  sku: string | null;
  name: string;
}

export const isPickList = (modifier: Record<string, unknown>) => modifier.type === "product_list" || modifier.type === "product_list_with_images";

export interface PackProductRaw {
  fields: Record<string, unknown>;
  brandName: string | null;
  variants: BcVariant[];
  customFields: { name: string; value: string }[];
  // `file` is set on sample products: a name in the samples repo's images folder, used instead of `url`.
  images: { url: string; file?: string; isThumbnail: boolean; sortOrder: number; description: string }[];
  bulkPricingRules: Record<string, unknown>[];
  videos: Record<string, unknown>[];
  modifiers: Record<string, unknown>[];
  customUrl: string | null;
}

const asList = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

// Keeps only the listed keys, dropping store-specific ids.
function only(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return pick(source, keys);
}

// Pick lists are left out here: they point at other products, which may not exist yet. See pickListPayloads.
export function toModifierPayloads(modifiers: Record<string, unknown>[]): Record<string, unknown>[] {
  return modifiers.filter((modifier) => !isPickList(modifier)).map((modifier) => ({
    ...only(modifier, ["type", "required", "display_name", "config"]),
    option_values: asList(modifier.option_values).map((value) => ({ ...only(value, ["label", "sort_order", "value_data", "is_default", "adjusters"]) })),
  }));
}

function pick<T extends object>(source: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];

    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }

  return out;
}

export function buildCategoryPaths(categories: { id: number; parent_id: number; name: string }[]): Map<number, string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const paths = new Map<number, string>();

  for (const category of categories) {
    const names: string[] = [];
    const seen = new Set<number>();

    for (let current = category; current && !seen.has(current.id); current = byId.get(current.parent_id) as typeof category) {
      seen.add(current.id);
      names.unshift(current.name);
    }

    paths.set(category.id, names.join(CATEGORY_SEPARATOR));
  }

  return paths;
}

// Replaces each pick-list entry's product id (meaningless in another store) with a ref to find it by.
function withProductRefs(modifier: Record<string, unknown>, refs: Map<number, ProductRef> | undefined): Record<string, unknown> {
  const values = asList(modifier.option_values).flatMap((value) => {
    const id = (value.value_data as { product_id?: number } | undefined)?.product_id;
    const ref = id !== undefined ? refs?.get(id) : undefined;

    return ref ? [{ ...only(value, ["label", "sort_order", "is_default", "adjusters"]), ref }] : [];
  });

  return { ...modifier, option_values: values };
}

export function toPackProduct(product: BcProduct, context: MapContext): PackProduct {
  const images = [...(product.images ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).flatMap((image) => {
    const url = image.url_zoom ?? image.url_standard;

    return url ? [{ url, isThumbnail: Boolean(image.is_thumbnail), sortOrder: image.sort_order ?? 0, description: image.description ?? "" }] : [];
  });
  // A product with no options still has one default variant; only variants
  // that carry option values are worth recreating.
  const variants = (product.variants ?? []).filter((variant) => (variant.option_values?.length ?? 0) > 0);
  const raw: PackProductRaw = {
    fields: pick(product, COPIED_FIELDS),
    brandName: product.brand_id ? (context.brandNames.get(product.brand_id) ?? null) : null,
    variants,
    customFields: (product.custom_fields ?? []).map(({ name, value }) => ({ name, value })),
    images,
    bulkPricingRules: asList(product.bulk_pricing_rules).map((rule) => only(rule, ["quantity_min", "quantity_max", "type", "amount"])),
    videos: asList(product.videos).map((video) => only(video, ["title", "description", "sort_order", "type", "video_id"])),
    modifiers: asList(product.modifiers).map((modifier) => (isPickList(modifier) ? withProductRefs(modifier, context.productRefs) : modifier)),
    customUrl: typeof (product.custom_url as { url?: unknown } | undefined)?.url === "string" ? ((product.custom_url as { url: string }).url) : null,
  };

  return {
    name: product.name,
    sku: typeof product.sku === "string" && product.sku ? product.sku : null,
    price: typeof product.price === "number" ? product.price : null,
    description: typeof product.description === "string" ? product.description : null,
    imageUrls: images.map((image) => image.url),
    categoryPaths: (product.categories ?? []).flatMap((id) => context.categoryPaths.get(id) ?? []),
    raw: raw as unknown as Record<string, unknown>,
  };
}

export interface ResolvedIds {
  brandId: number | undefined;
  categoryIds: number[];
}

// The POST /v3/catalog/products body for a pack product.
export function toCreatePayload(product: PackProduct, ids: ResolvedIds, options: { keepUrl?: boolean } = {}): Record<string, unknown> {
  const raw = product.raw as unknown as Partial<PackProductRaw>;
  const body: Record<string, unknown> = { ...(raw.fields ?? {}), name: product.name };

  if (!("type" in body)) body.type = "physical";
  if (!("price" in body)) body.price = product.price ?? 0;
  if (!("weight" in body)) body.weight = 0;
  if (ids.brandId) body.brand_id = ids.brandId;
  if (ids.categoryIds.length) body.categories = ids.categoryIds;
  if (raw.customFields?.length) body.custom_fields = raw.customFields;
  if (raw.bulkPricingRules?.length) body.bulk_pricing_rules = raw.bulkPricingRules;
  if (raw.videos?.length) body.videos = raw.videos;
  if (raw.customUrl && options.keepUrl !== false) body.custom_url = { url: raw.customUrl, is_customized: true };
  if (raw.images?.length) body.images = raw.images.map((image) => ({ image_url: image.url, is_thumbnail: image.isThumbnail, sort_order: image.sortOrder, description: image.description }));

  if (raw.variants?.length) {
    // Variants need their own SKUs; drop the product-level SKU so it doesn't
    // collide with the first variant's.
    body.variants = raw.variants.map((variant) => ({ ...pick(variant, VARIANT_FIELDS), option_values: (variant.option_values ?? []).map((value) => ({ option_display_name: value.option_display_name, label: value.label })) }));
  }

  return body;
}

// The pick lists of a product, ready to create once the products they point at exist. `resolve`
// turns a ref into that product's id in the destination store; entries it can't find are left out.
export function pickListPayloads(modifiers: Record<string, unknown>[], resolve: (ref: ProductRef) => number | undefined): { payloads: Record<string, unknown>[]; missing: string[] } {
  const missing: string[] = [];
  const payloads = modifiers.filter(isPickList).map((modifier) => ({
    ...only(modifier, ["type", "required", "display_name", "config"]),
    option_values: asList(modifier.option_values).flatMap((value) => {
      const ref = value.ref as ProductRef | undefined;
      const id = ref ? resolve(ref) : undefined;

      if (id === undefined) {
        missing.push(ref ? (ref.sku ?? ref.name) : String(value.label ?? "an item"));

        return [];
      }

      return [{ ...only(value, ["label", "sort_order", "is_default", "adjusters"]), value_data: { product_id: id } }];
    }),
  }));

  return { payloads: payloads.filter((payload) => payload.option_values.length > 0), missing };
}
