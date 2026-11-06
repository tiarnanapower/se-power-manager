// Copies pack images to Vercel Blob so they outlive the product they came from.
// BigCommerce deletes a product's images when the product is deleted, so a pack
// that only links to them can't restore its pictures.
import "server-only";
import { createHash } from "node:crypto";
import { head, put } from "@vercel/blob";
import type { ImageStore } from "@/lib/catalog/images";
import { logError } from "@/lib/errors/logger";

const MAX_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

function isPublicHttps(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isPrivate = host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.includes(":");

    return parsed.protocol === "https:" && !isPrivate ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function download(url: URL): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: "follow" });

  if (!response.ok) return undefined;

  // Content types can carry parameters ("image/jpeg; charset=binary").
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  if (!EXTENSIONS[contentType]) return undefined;
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return undefined;

  const bytes = Buffer.from(await response.arrayBuffer());

  return bytes.length > 0 && bytes.length <= MAX_BYTES ? { bytes, contentType } : undefined;
}

export const blobImageStore: ImageStore = {
  // A classic read-write token, or the newer store id. With a store id, Vercel signs the app in
  // itself when deployed; locally it needs the VERCEL_OIDC_TOKEN that `vercel env pull` provides.
  configured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN))),

  async preserve(url) {
    const source = isPublicHttps(url);

    if (!source) return null;

    try {
      const file = await download(source);

      if (!file) return null;

      // Named by content, so the same picture saved in many packs is stored once.
      const pathname = `pack-images/${createHash("sha256").update(file.bytes).digest("hex")}.${EXTENSIONS[file.contentType]}`;
      const existing = await head(pathname).catch(() => undefined);

      if (existing) return existing.url;

      const stored = await put(pathname, file.bytes, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: file.contentType, cacheControlMaxAge: 31_536_000 });

      return stored.url;
    } catch (error) {
      logError("blobImageStore.preserve", error);

      return null;
    }
  },
};
