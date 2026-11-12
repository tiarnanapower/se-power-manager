"use client";

// Builds a snapshot of the connected store in the browser and hands it over as a zip. It asks the server
// for one small piece at a time (a few products, one picture, one section), so nothing is limited by
// the size of a single response.
import { getRepoStateAction, planSnapshotAction, snapshotImageAction, snapshotPageAction, snapshotSectionAction } from "@/app/store/[storeHash]/catalog/personal/snapshot-actions";
import type { PackProduct } from "@/lib/app-data/types";
import { CATEGORY_SEPARATOR, type PackProductRaw } from "@/lib/catalog/pack-mapper";
import { assembleSample } from "@/lib/samples/assemble";
import type { SampleSectionId } from "@/lib/samples/format";
import { createZip } from "@/lib/samples/zip";

export interface SnapshotOptions {
  name: string;
  slug: string;
  description?: string;
  tags?: string[];
  notes?: string;
  // Settings to include besides the catalog.
  sections: SampleSectionId[];
  // Only these products (for the backup before a clear of just the app's own products).
  ids?: number[];
  onProgress?: (stage: string, fraction: number) => void;
}

export interface SnapshotResult {
  file: string;
  bytes: Uint8Array;
  version: string;
  counts: { products: number; categories: number; images: number };
  warnings: string[];
}

const fromBase64 = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Every category a product sits in, plus its parents.
export function withAncestors(paths: string[]): string[] {
  const all = new Set<string>();

  for (const path of paths) {
    const parts = path.split(CATEGORY_SEPARATOR);

    for (let length = 1; length <= parts.length; length += 1) all.add(parts.slice(0, length).join(CATEGORY_SEPARATOR));
  }

  return [...all];
}

export async function buildStoreSnapshot(storeHash: string | undefined, options: SnapshotOptions): Promise<SnapshotResult> {
  const progress = options.onProgress ?? (() => undefined);

  progress("Reading the store", 0);

  const plan = await planSnapshotAction(storeHash, { ids: options.ids });

  if (!plan.ok) throw new Error(plan.message);
  if (plan.ids.length === 0) throw new Error("There are no products to put in a snapshot.");

  const repo = await getRepoStateAction(storeHash, { slug: options.slug });

  if (!repo.ok) throw new Error(repo.message);

  const products: PackProduct[] = [];
  const pictures = new Map<string, { bytes: Uint8Array; mime: string }>();
  const page = 20;

  for (let at = 0; at < plan.ids.length; at += page) {
    progress(`Reading products ${at + 1}–${Math.min(at + page, plan.ids.length)} of ${plan.ids.length}`, (at / plan.ids.length) * 0.8);

    const result = await snapshotPageAction(storeHash, { ids: plan.ids.slice(at, at + page), refs: plan.refs });

    if (!result.ok) throw new Error(result.message);

    const urls = [...new Set(result.products.flatMap((product) => ((product.raw as unknown as Partial<PackProductRaw>).images ?? []).map((image) => image.url)).filter(Boolean))];

    for (let next = 0; next < urls.length; next += 3) {
      await Promise.all(urls.slice(next, next + 3).map(async (url) => {
        const picture = await snapshotImageAction(storeHash, { url }).catch(() => undefined);

        if (picture?.ok && picture.image) pictures.set(url, { bytes: fromBase64(picture.image.base64), mime: picture.image.mime });
      }));
    }

    products.push(...result.products);
  }

  const sections: NonNullable<Parameters<typeof assembleSample>[0]["sections"]> = {};
  const warnings: string[] = [];

  for (const id of options.sections) {
    if (id === "catalog") continue;

    progress(`Reading ${id}`, 0.85);

    const captured = await snapshotSectionAction(storeHash, { section: id });

    if (captured.ok) sections[id] = { data: captured.data, warnings: captured.warnings };
    else warnings.push(`${id}: ${captured.message}`);
  }

  progress("Building the files", 0.9);

  const existing: Record<string, string | null> = { "catalog.json": repo.index, [`samples/${options.slug}/sample.json`]: repo.meta };
  const assembled = await assembleSample(
    { products, categoryPaths: withAncestors(products.flatMap((product) => product.categoryPaths)), brands: products.map((product) => (product.raw as { brandName?: string | null }).brandName).filter((brand): brand is string => Boolean(brand)), sections, warnings },
    {
      name: options.name,
      slug: options.slug,
      description: options.description,
      tags: options.tags,
      notes: options.notes,
      readExisting: async (path) => existing[path] ?? undefined,
      fetchImage: async (url) => pictures.get(url),
      sha256,
    },
  );

  progress("Zipping", 0.97);

  const bytes = createZip(assembled.files);

  return { file: `${options.slug}-${assembled.version}.zip`, bytes, version: assembled.version, counts: assembled.counts, warnings: assembled.warnings.slice(0, 30) };
}

export function downloadBytes(file: string, bytes: Uint8Array, type = "application/zip"): void {
  const link = document.createElement("a");

  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  link.download = file;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
