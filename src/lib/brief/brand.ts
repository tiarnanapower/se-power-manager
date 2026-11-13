// What can be read about a brand straight from a customer's site, without any AI: colours, fonts, logo,
// contact details, social links and navigation. Pure functions over the page's HTML and stylesheet text,
// so they are tested without a network.
import { decodeEntities } from "@/lib/import/page-digest";

export type Role = "primary" | "secondary" | "tertiary" | "neutral";

export interface BrandColour {
  hex: string;
  role?: Role;
  // How strongly the site uses it, for ordering. Not a percentage.
  weight: number;
}

export interface Brand {
  siteName: string;
  description: string;
  logo: string | null;
  colours: BrandColour[];
  fonts: { heading: string | null; body: string | null; all: string[] };
  contact: { phone: string | null; email: string | null; address: string | null };
  social: { name: string; url: string }[];
  nav: string[];
  headings: string[];
}

// ---------- Colours ----------

interface Rgb { r: number; g: number; b: number }

function parseColour(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((char) => char + char).join("") : hex[1];

    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }

  const rgb = value.trim().match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);

  if (rgb) return { r: Math.min(255, +rgb[1]), g: Math.min(255, +rgb[2]), b: Math.min(255, +rgb[3]) };

  const hslMatch = value.trim().match(/^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%/i);

  if (!hslMatch) return null;

  const [h, s, l] = [+hslMatch[1] % 360, Math.min(100, +hslMatch[2]) / 100, Math.min(100, +hslMatch[3]) / 100];
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;

    return Math.round((l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };

  return { r: channel(0), g: channel(8), b: channel(4) };
}

const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

const distance = (a: Rgb, b: Rgb) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

const COLOUR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}[^)]*\)|hsla?\(\s*\d{1,3}(?:\.\d+)?(?:deg)?[\s,]+\d{1,3}(?:\.\d+)?%[\s,]+\d{1,3}(?:\.\d+)?%[^)]*\)/gi;
const BRAND_VAR = /--[\w-]*(primary|brand|accent|main|theme)[\w-]*\s*:\s*([^;}]+)/gi;

// Brand colours are the vivid ones. Pure white, black and greys are everywhere, so they are only used
// for the neutral.
export function extractColours(html: string, css: string): BrandColour[] {
  const weights = new Map<string, { rgb: Rgb; weight: number }>();
  const add = (raw: string, weight: number) => {
    const rgb = parseColour(raw);

    if (!rgb) return;

    const hex = toHex(rgb);
    const entry = weights.get(hex) ?? { rgb, weight: 0 };

    entry.weight += weight;
    weights.set(hex, entry);
  };

  for (const match of `${css}\n${html.replace(/<(script|svg)\b[\s\S]*?<\/\1>/gi, " ")}`.matchAll(COLOUR)) add(match[0], 1);

  // A custom property called primary, brand or accent says outright which colour is the brand's.
  for (const match of `${css}\n${html}`.matchAll(BRAND_VAR)) for (const found of match[2].matchAll(COLOUR)) add(found[0], 12);

  const theme = html.match(/<meta\b[^>]*name\s*=\s*["']theme-color["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1];

  if (theme) add(theme, 10);

  // Frequency counts, but a vivid mid-tone colour is far more likely to be the brand than a pale tint.
  const score = (colour: { weight: number; s: number; l: number }) => colour.weight * (0.4 + colour.s) * (colour.l >= 0.2 && colour.l <= 0.7 ? 1 : 0.6);
  const all = [...weights.entries()].map(([hex, { rgb, weight }]) => ({ hex, rgb, weight, ...hsl(rgb) }));
  const vivid = all.filter((colour) => colour.s >= 0.25 && colour.l > 0.12 && colour.l < 0.9).sort((a, b) => score(b) - score(a));
  const picked: typeof vivid = [];

  // Keep colours that look different from the ones already chosen.
  for (const colour of vivid) if (picked.every((other) => distance(other.rgb, colour.rgb) > 70)) picked.push(colour);

  const roles: Role[] = ["primary", "secondary", "tertiary"];
  const result: BrandColour[] = picked.slice(0, 5).map((colour, index) => ({ hex: colour.hex, weight: colour.weight, ...(index < 3 ? { role: roles[index] } : {}) }));
  // Near-white colours always look saturated in HSL, so spread between the channels is used instead.
  const light = all.filter((colour) => colour.l > 0.88 && Math.max(colour.rgb.r, colour.rgb.g, colour.rgb.b) - Math.min(colour.rgb.r, colour.rgb.g, colour.rgb.b) <= 24 && colour.hex !== "#FFFFFF").sort((a, b) => b.weight - a.weight)[0];

  result.push({ hex: light?.hex ?? "#F5F5F5", weight: light?.weight ?? 0, role: "neutral" });

  return result;
}

// ---------- Fonts ----------

const GENERIC = new Set(["inherit", "initial", "unset", "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "-apple-system", "blinkmacsystemfont", "segoe ui", "emoji", "ui-monospace", "ui-rounded", "sfmono-regular", "menlo", "monaco", "consolas", "courier new", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "helvetica neue", "helvetica", "arial", "roboto"]);

function firstFamily(value: string): string | null {
  for (const part of value.split(",")) {
    const name = part.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/i, "").trim();

    if (name && !/[()]/.test(name) && !name.startsWith("--") && !GENERIC.has(name.toLowerCase())) return name;
  }

  return null;
}

export function extractFonts(html: string, css: string): Brand["fonts"] {
  const counts = new Map<string, number>();
  let heading: string | null = null;
  let body: string | null = null;

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const family = rule[2].match(/font-family\s*:\s*([^;}]+)/i)?.[1];
    const name = family ? firstFamily(family) : null;

    if (!name) continue;

    counts.set(name, (counts.get(name) ?? 0) + 1);

    const selector = rule[1].trim().toLowerCase();

    if (!heading && /(^|[\s,])h[1-3]\b/.test(selector)) heading = name;
    if (!body && /(^|[\s,])(body|html)\b/.test(selector)) body = name;
  }

  // Google Fonts links name the families outright.
  for (const link of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>\s]+)/gi)) {
    for (const family of decodeEntities(link[1]).matchAll(/family=([^&:;]+)/g)) {
      const name = decodeURIComponent(family[1]).replace(/\+/g, " ").trim();

      counts.set(name, (counts.get(name) ?? 0) + 3);
    }
  }

  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 6);

  return { heading: heading ?? all[0] ?? null, body: body ?? all.find((name) => name !== heading) ?? all[0] ?? null, all };
}

// ---------- Everything else ----------

const absolute = (value: string | null | undefined, base: string): string | null => {
  if (!value) return null;

  try {
    const url = new URL(decodeEntities(value.trim()), base);

    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2, 5).find((part) => part !== undefined) ?? null;
const strip = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const queue = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of queue) {
        if (item && typeof item === "object") {
          out.push(item as Record<string, unknown>);

          const graph = (item as { "@graph"?: unknown })["@graph"];

          if (Array.isArray(graph)) for (const node of graph) if (node && typeof node === "object") out.push(node as Record<string, unknown>);
        }
      }
    } catch {
      // A broken block is just skipped.
    }
  }

  return out;
}

const SOCIALS: [string, RegExp][] = [["Facebook", /facebook\.com/i], ["Instagram", /instagram\.com/i], ["LinkedIn", /linkedin\.com/i], ["X", /(^|\.)(x|twitter)\.com/i], ["YouTube", /youtube\.com|youtu\.be/i], ["TikTok", /tiktok\.com/i], ["Pinterest", /pinterest\./i]];

export function extractBrand(html: string, pageUrl: string, css = ""): Brand {
  const meta = (name: string) => html.match(new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, "i"))?.[0] ?? "";
  const metaContent = (name: string) => decodeEntities(attr(meta(name), "content") ?? "").trim();
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
  const ld = jsonLdObjects(html);
  const organisation = ld.find((item) => /Organization|LocalBusiness|Store/i.test(String(item["@type"] ?? "")));
  const siteName = metaContent("og:site_name") || (typeof organisation?.name === "string" ? organisation.name : "") || title.split(/[|\-–—]/).pop()?.trim() || title;

  // The logo: an image called logo (inside the header when there is one), else structured data.
  const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "";
  const logoTag = [...header.matchAll(/<img\b[^>]*>/gi), ...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]).find((tag) => /logo/i.test(tag));
  const ldLogo = typeof organisation?.logo === "string" ? organisation.logo : typeof (organisation?.logo as { url?: unknown })?.url === "string" ? ((organisation?.logo as { url: string }).url) : null;
  // A favicon is not a logo, so when the logo is drawn inline or loaded by script there is none to offer.
  const logo = absolute(logoTag ? attr(logoTag, "src") ?? attr(logoTag, "data-src") : null, pageUrl) ?? absolute(ldLogo, pageUrl);

  const address = organisation?.address as Record<string, unknown> | string | undefined;
  const addressText = typeof address === "string" ? address : address ? [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry].filter((part) => typeof part === "string" && part).join(", ") : "";
  const phone = (typeof organisation?.telephone === "string" ? organisation.telephone : "") || decodeURIComponent(html.match(/href\s*=\s*["']tel:([^"']+)["']/i)?.[1] ?? "");
  const email = (typeof organisation?.email === "string" ? organisation.email : "") || (html.match(/href\s*=\s*["']mailto:([^"'?]+)/i)?.[1] ?? "");

  const social: Brand["social"] = [];

  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    const href = absolute(match[1], pageUrl);
    const network = href ? SOCIALS.find(([, pattern]) => pattern.test(new URL(href).hostname)) : undefined;

    if (href && network && !social.some((entry) => entry.name === network[0]) && new URL(href).pathname.length > 1) social.push({ name: network[0], url: href });
  }

  const nav: string[] = [];
  const navHtml = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? "";

  for (const match of navHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = strip(match[1]);

    if (label && label.length <= 30 && !nav.includes(label)) nav.push(label);
  }

  const headings: string[] = [];

  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const label = strip(match[1]);

    if (label && label.length <= 120 && !headings.includes(label)) headings.push(label);
  }

  return {
    siteName: siteName.slice(0, 80),
    description: metaContent("og:description") || metaContent("description"),
    logo,
    colours: extractColours(html, css),
    fonts: extractFonts(html, css),
    contact: { phone: phone || null, email: email || null, address: addressText || null },
    social: social.slice(0, 6),
    nav: nav.slice(0, 12),
    headings: headings.slice(0, 25),
  };
}

// The stylesheets a page links to, so their colours and fonts can be read too.
export function stylesheetLinks(html: string, pageUrl: string, limit = 4): string[] {
  const links: string[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;

    const href = absolute(attr(tag, "href"), pageUrl);

    if (href && !/fonts\.googleapis\.com/i.test(href) && !links.includes(href)) links.push(href);
  }

  return links.slice(0, limit);
}

export const inlineStyles = (html: string): string => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
