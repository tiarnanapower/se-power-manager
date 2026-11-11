// What the Sample Catalog pages and import need from the samples repo.
import "server-only";
import { AppError } from "@/lib/errors/app-error";
import { listCommits, readBytes, readJson, type CommitInfo } from "@/lib/samples/github";
import {
  assertSupportedFormat,
  chunkFor,
  chunkName,
  imagePath,
  INDEX_PATH,
  isImageFile,
  isSlug,
  isVersion,
  samplePath,
  versionPath,
  type SampleCatalogFile,
  type SampleIndex,
  type SampleManifest,
  type SampleMeta,
  type SampleProduct,
} from "@/lib/samples/format";

const invalid = (what: string) => new AppError("VALIDATION", `Invalid ${what}.`, { detail: `That ${what} isn't valid.` });

function checkSlug(slug: string): string {
  if (!isSlug(slug)) throw invalid("sample name");

  return slug;
}

function checkVersion(version: string): string {
  if (!isVersion(version)) throw invalid("version");

  return version;
}

// An empty or brand-new repo has no index yet; that's an empty library, not an error.
export async function getIndex(): Promise<SampleIndex> {
  try {
    const index = await readJson<SampleIndex>(INDEX_PATH);

    assertSupportedFormat(index.format ?? 1);

    return { format: index.format ?? 1, samples: Array.isArray(index.samples) ? index.samples : [] };
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") return { format: 1, samples: [] };

    throw error;
  }
}

export async function getSampleMeta(slug: string): Promise<SampleMeta> {
  return readJson<SampleMeta>(samplePath(checkSlug(slug), "sample.json"));
}

export interface VersionBundle {
  meta: SampleMeta;
  version: string;
  manifest: SampleManifest;
  catalog: SampleCatalogFile | undefined;
}

// `version` defaults to the sample's latest.
export async function getVersion(slug: string, version?: string): Promise<VersionBundle> {
  const meta = await getSampleMeta(slug);
  const chosen = checkVersion(version ?? meta.latest);

  if (!meta.versions.some((entry) => entry.version === chosen)) throw new AppError("NOT_FOUND", "That version doesn't exist.", { detail: `${meta.name} has no version ${chosen}.` });

  const manifest = await readJson<SampleManifest>(versionPath(slug, chosen, "manifest.json"));

  assertSupportedFormat(manifest.formatVersion);

  const catalogEntry = manifest.sections.catalog;
  const catalog = catalogEntry ? await readJson<SampleCatalogFile>(versionPath(slug, chosen, catalogEntry.file)) : undefined;

  return { meta, version: chosen, manifest, catalog };
}

export async function getProducts(slug: string, version: string, start: number, count: number): Promise<SampleProduct[]> {
  checkSlug(slug);
  checkVersion(version);

  const products: SampleProduct[] = [];

  for (let index = start; index < start + count; ) {
    const { file, offset } = chunkFor(index);
    const chunk = await readJson<SampleProduct[]>(versionPath(slug, version, "catalog", chunkName(file)));
    const take = chunk.slice(offset, offset + (start + count - index));

    if (take.length === 0) break;

    products.push(...take);
    index += take.length;
  }

  return products;
}

export async function getProduct(slug: string, version: string, index: number): Promise<SampleProduct | undefined> {
  return (await getProducts(slug, version, index, 1))[0];
}

export async function getSectionFile<T>(slug: string, version: string, file: string): Promise<T> {
  if (file.includes("..") || file.startsWith("/")) throw invalid("section file");

  return readJson<T>(versionPath(checkSlug(slug), checkVersion(version), file));
}

// Image bytes by content-hash file name. Images never change, so they can be cached for a long time.
export async function getImage(file: string): Promise<Buffer> {
  if (!isImageFile(file)) throw invalid("image");

  return readBytes(imagePath(file), { ttlMs: 60 * 60_000 });
}

export async function getHistory(slug: string): Promise<CommitInfo[]> {
  return listCommits(samplePath(checkSlug(slug)));
}
