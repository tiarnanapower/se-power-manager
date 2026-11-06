// Boils a product page's HTML down to what the AI needs: structured data
// (JSON-LD, Open Graph), readable text, and candidate image URLs. Pure, so it
// can be tested without a network.

export interface PageDigest {
  url: string;
  title: string;
  meta: Record<string, string>;
  jsonLd: string[];
  text: string;
  images: ImageCandidate[];
}

// An image found on the page, with the clues that tie it to a product: its alt
// text and the link it sits inside (usually the product's own page).
export interface ImageCandidate {
  url: string;
  alt: string;
  href: string | null;
}

const MAX_TEXT = 14_000;
const MAX_JSON_LD = 12_000;
const MAX_IMAGES = 150;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);

      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }

    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function absolute(candidate: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(candidate.trim()), base);

    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));

  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null;
}

const SKIP_IMAGE = /(sprite|logo|icon|favicon|pixel|spacer|blank|tracking|badge|payment|flag|avatar|placeholder)/i;

export function digestPage(html: string, url: string): PageDigest {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
  const meta: Record<string, string> = {};

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attr(tag, "property") ?? attr(tag, "name");
    const content = attr(tag, "content");

    if (key && content && /^(og:|product:|twitter:(title|description|image)|description$|keywords$)/i.test(key)) meta[key.toLowerCase()] = decodeEntities(content).slice(0, 400);
  }

  const jsonLd: string[] = [];
  let jsonLdSize = 0;

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1].trim();

    if (!/"@type"\s*:\s*\[?\s*"(Product|ProductGroup|ItemList|Offer|CollectionPage)"/i.test(body) || jsonLdSize + body.length > MAX_JSON_LD) continue;

    jsonLd.push(body);
    jsonLdSize += body.length;
  }

  const images: ImageCandidate[] = [];
  const seen = new Set<string>();
  const addImage = (candidate: string | null, alt = "", href: string | null = null) => {
    const resolved = candidate ? absolute(candidate, url) : null;

    if (!resolved || seen.has(resolved) || SKIP_IMAGE.test(new URL(resolved).pathname) || /\.(svg|gif)(\?|$)/i.test(resolved)) return;

    seen.add(resolved);
    images.push({ url: resolved, alt: decodeEntities(alt).trim().slice(0, 160), href: href ? absolute(href, url) : null });
  };

  addImage(meta["og:image"] ?? null, meta["og:title"] ?? "");

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    const largest = srcset?.split(",").map((part) => part.trim().split(/\s+/)).filter((part) => part[0]).sort((a, b) => parseInt(b[1] ?? "0", 10) - parseInt(a[1] ?? "0", 10))[0]?.[0];
    // The link this image sits in: the nearest <a href> before it that hasn't been closed.
    const before = html.slice(Math.max(0, (match.index ?? 0) - 600), match.index ?? 0);
    const anchor = before.lastIndexOf("<a ");
    const href = anchor >= 0 && !before.slice(anchor).includes("</a>") ? attr(before.slice(anchor).match(/<a\b[^>]*>/i)?.[0] ?? "", "href") : null;

    addImage(largest ?? attr(tag, "data-src") ?? attr(tag, "data-original") ?? attr(tag, "src"), attr(tag, "alt") ?? attr(tag, "title") ?? "", href);
  }

  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

  return { url, title, meta, jsonLd, text, images: images.slice(0, MAX_IMAGES) };
}
