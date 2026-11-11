// The "AI prompt" route for the Import Tool: the SE asks Claude or ChatGPT to read a
// customer site, pastes the JSON answer back, and it is turned into the same rows the
// scraper produces. Pure and client-safe (no server imports), so the panel can parse
// the paste in the browser and show problems immediately.
import type { ScrapedProduct } from "@/lib/import/scrape";

export const MAX_PASTED_PRODUCTS = 200;

export function buildImportPrompt(urls: string[], count: number): string {
  const sites = urls.length ? urls.join("\n") : "https://your-customer-site.com";

  return `Visit these pages and find up to ${count} real products from each:

${sites}

For every product return an object with:
- "name": the exact product name from the site
- "price": the current selling price as a plain number, e.g. 49.99 (no currency symbol)
- "sku": the SKU or product code if the site shows one, otherwise null
- "brand": the brand name, or null
- "category": a short category path such as "Clothing > T-Shirts", or null
- "description": 1-3 plain-text sentences describing the product
- "images": up to 5 real image URLs from the site, best photo first. Every URL must start with https:// and be a direct link to an image file.
- "url": the product's own page address

Rules:
- Only include products that are really on the site. Do not invent products, prices or image links.
- Return ONLY a valid JSON array. No explanation and no markdown fences.

Example:
[{"name":"Trail Runner","price":89.99,"sku":"TR-100","brand":"Acme","category":"Shoes > Running","description":"Lightweight trail running shoe with a grippy sole.","images":["https://example.com/images/trail-runner.jpg"],"url":"https://example.com/products/trail-runner"}]`;
}

// Cleans what chat apps do to JSON: code fences, curly quotes, zero-width characters.
function clean(raw: string): string {
  return raw
    .replace(/^[﻿​-‍ ]+/, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function firstJson(text: string): unknown {
  const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index >= 0);

  if (starts.length === 0) throw new Error("No JSON found. Copy the whole answer, starting from the opening [ .");

  const start = Math.min(...starts);
  const closer = text[start] === "[" ? "]" : "}";
  const end = text.lastIndexOf(closer);

  if (end <= start) throw new Error("The JSON looks cut off. Copy the complete answer and try again.");

  const body = text.slice(start, end + 1).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`That isn't valid JSON (${(error as Error).message}). Ask the AI to output the JSON again, then paste the complete answer.`);
  }
}

const asText = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "");

function asPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string") return null;

  const parsed = parseFloat(value.replace(/[^0-9.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value.trim());

    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asImages(item: Record<string, unknown>): string[] {
  const raw = item.images ?? item.image_urls ?? item.imageUrls ?? item.image_url ?? item.image;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const urls = list.map((entry) => asHttpUrl(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).url : entry)).filter((url): url is string => url !== null);

  return [...new Set(urls)].slice(0, 5);
}

function asCategory(value: unknown): string | null {
  const list = Array.isArray(value) ? value : [value];
  const names = list.map((entry) => asText(entry, 100)).filter(Boolean);

  return names.length ? names.join(" > ").slice(0, 200) : null;
}

export interface PasteResult {
  products: ScrapedProduct[];
  // Entries that had no name and were left out.
  skipped: number;
}

// `fallbackUrl` becomes the source address of products that don't give their own page.
export function parsePastedProducts(raw: string, fallbackUrl = "https://pasted-from-ai.invalid/"): PasteResult {
  const parsed = firstJson(clean(raw));
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { products?: unknown })?.products) ? (parsed as { products: unknown[] }).products : null;

  if (!list) throw new Error('Expected a list of products. The JSON should start with [ or look like {"products": [ ... ]}.');
  if (list.length === 0) throw new Error("The list is empty.");

  const names = new Set<string>();
  const products: ScrapedProduct[] = [];
  let skipped = 0;

  for (const entry of list.slice(0, MAX_PASTED_PRODUCTS)) {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const name = asText(item.name ?? item.title ?? item.product_name, 250);
    const key = name.toLowerCase();

    if (!name || names.has(key)) {
      skipped += 1;
      continue;
    }

    names.add(key);
    products.push({
      name,
      price: asPrice(item.price),
      sku: asText(item.sku ?? item.code, 255) || null,
      brand: asText(item.brand ?? item.vendor, 100) || null,
      category: asCategory(item.category ?? item.categories),
      description: asText(item.description, 4000),
      imageUrls: asImages(item),
      sourceUrl: asHttpUrl(item.url ?? item.product_url ?? item.link) ?? fallbackUrl,
    });
  }

  if (products.length === 0) throw new Error("None of the entries had a product name.");

  return { products, skipped };
}
