// Opens the files of an uploaded snapshot (a zip or a folder) the way the library opens the samples
// repo: a snapshot is exactly a repo's layout, so one folder can hold several samples and versions.
// Pure and synchronous: the caller has already read the files into memory.
import {
  assertSupportedFormat,
  chunkFor,
  isImageFile,
  isSlug,
  isVersion,
  type SampleCatalogFile,
  type SampleManifest,
  type SampleMeta,
  type SampleProduct,
} from "@/lib/samples/format";

export type Files = Map<string, Uint8Array>;

export interface BundleSample {
  slug: string;
  version: string;
  name: string;
  description: string;
  meta: SampleMeta | undefined;
  manifest: SampleManifest;
  catalog: SampleCatalogFile | undefined;
  languages: string[];
  defaultLanguage: string;
  product: (index: number) => SampleProduct | undefined;
  products: (start: number, count: number) => SampleProduct[];
  image: (file: string) => Uint8Array | undefined;
  section: (file: string) => unknown;
}

export interface OpenedBundle {
  samples: BundleSample[];
  problems: string[];
}

const decoder = new TextDecoder();

function json<T>(files: Files, path: string): T | undefined {
  const bytes = files.get(path);

  if (!bytes) return undefined;

  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch {
    throw new Error(`${path} isn't valid JSON.`);
  }
}

// Folders picked in a browser start with the folder's own name, and a zipped folder usually does too.
const REPO_MANIFEST = /^(?:(.*?)\/)?samples\/([^/]+)\/(v\d{1,4})\/manifest\.json$/;
const BARE_MANIFEST = /^(?:.*\/)?manifest\.json$/;

export function openBundle(files: Files): OpenedBundle {
  const samples: BundleSample[] = [];
  const problems: string[] = [];

  for (const path of files.keys()) {
    const match = path.match(REPO_MANIFEST) ?? (BARE_MANIFEST.test(path) ? ([path, undefined, undefined, undefined] as unknown as RegExpMatchArray) : null);

    if (!match) continue;

    // Two layouts: the repo's (<root>/samples/<slug>/<version>/manifest.json) or one version folder
    // on its own (<dir>/manifest.json).
    const repoLayout = match[2] !== undefined;
    const versionDir = path.slice(0, -"manifest.json".length);
    const root = repoLayout ? (match[1] ? `${match[1]}/` : "") : versionDir;

    try {
      const manifest = json<SampleManifest>(files, path)!;

      assertSupportedFormat(manifest.formatVersion ?? 1);

      const slug = repoLayout ? match[2] : manifest.slug;
      const version = repoLayout ? match[3] : manifest.version;

      if (!isSlug(slug) || !isVersion(version)) throw new Error("its name or version isn't valid");

      const meta = repoLayout ? json<SampleMeta>(files, `${root}samples/${slug}/sample.json`) : undefined;
      const catalog = manifest.sections?.catalog ? json<SampleCatalogFile>(files, `${versionDir}${manifest.sections.catalog.file}`) : undefined;
      const chunks = new Map<string, SampleProduct[]>();
      const chunk = (file: number): SampleProduct[] => {
        const name = catalog?.chunks[file];

        if (!name) return [];

        const known = chunks.get(name);

        if (known) return known;

        const list = json<SampleProduct[]>(files, `${versionDir}catalog/${name}`);

        if (!Array.isArray(list)) throw new Error(`${name} is missing from the snapshot.`);

        chunks.set(name, list);

        return list;
      };
      const total = catalog?.products.length ?? 0;

      samples.push({
        slug,
        version,
        name: meta?.name ?? slug,
        description: meta?.description ?? "",
        meta,
        manifest,
        catalog,
        languages: meta?.languages ?? [manifest.defaultLanguage ?? "en"],
        defaultLanguage: manifest.defaultLanguage ?? "en",
        product: (index) => {
          const { file, offset } = chunkFor(index);

          return index >= 0 && index < total ? chunk(file)[offset] : undefined;
        },
        products: (start, count) => {
          const out: SampleProduct[] = [];

          for (let index = start; index < Math.min(total, start + count); index += 1) {
            const { file, offset } = chunkFor(index);
            const product = chunk(file)[offset];

            if (product) out.push(product);
          }

          return out;
        },
        image: (file) => (isImageFile(file) ? (files.get(`${root}images/${file}`) ?? files.get(`${versionDir}images/${file}`)) : undefined),
        section: (file) => json<unknown>(files, `${versionDir}${file}`),
      });
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : "couldn't be read"}`);
    }
  }

  // Newest version of each sample first.
  samples.sort((a, b) => a.slug.localeCompare(b.slug) || Number(b.version.slice(1)) - Number(a.version.slice(1)));

  return { samples, problems };
}
