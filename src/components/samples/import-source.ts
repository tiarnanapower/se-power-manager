// Where an Import sections popup gets its data from: a sample in the GitHub repo (read by the server)
// or a snapshot uploaded from this computer (sent to the server a few products at a time).
import { finishUploadPickListsAction, importUploadBatchAction, importUploadSectionAction } from "@/app/store/[storeHash]/catalog/personal/upload-actions";
import { finishSamplePickListsAction, importSampleBatchAction, importSampleSectionAction } from "@/app/store/[storeHash]/catalog/samples/actions";
import type { Outcome } from "@/lib/actions/run-action";
import type { RestoreBatchResult } from "@/lib/catalog/operations";
import type { BundleSample } from "@/lib/samples/bundle";
import type { SampleManifest, SampleProduct, SampleSectionId } from "@/lib/samples/format";
import type { SectionResult } from "@/lib/samples/sections/shared";

export interface PickListStep {
  nextOffset: number;
  done: boolean;
  created: number;
  warnings: { name: string; detail: string }[];
}

export interface ImportSource {
  name: string;
  version: string;
  productCount: number;
  manifest: SampleManifest;
  languages: string[];
  defaultLanguage: string;
  importBatch: (offset: number) => Promise<Outcome<{ batch: RestoreBatchResult }>>;
  finishPickLists: (offset: number) => Promise<Outcome<PickListStep>>;
  importSection: (id: SampleSectionId) => Promise<Outcome<{ result: SectionResult }>>;
}

export function repoSource(storeHash: string | undefined, sample: { slug: string; name: string; version: string; productCount: number; manifest: SampleManifest; languages: string[]; defaultLanguage: string }): ImportSource {
  const target = { slug: sample.slug, version: sample.version };

  return {
    ...sample,
    importBatch: (offset) => importSampleBatchAction(storeHash, { ...target, offset }),
    finishPickLists: async (offset) => {
      const result = await finishSamplePickListsAction(storeHash, { ...target, offset });

      return result.ok ? { ok: true, nextOffset: result.nextOffset, done: result.done, created: result.created, warnings: result.warnings } : result;
    },
    importSection: (id) => importSampleSectionAction(storeHash, { ...target, section: id }),
  };
}

// Each request stays well under the platform's 4.5 MB body limit, base64 included.
const BATCH_PRODUCTS = 10;
const BATCH_IMAGE_BYTES = 2_400_000;
const PICK_LIST_PAGE = 100;

function toBase64(bytes: Uint8Array): string {
  let text = "";

  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));

  return btoa(text);
}

const imageFiles = (product: SampleProduct): string[] => ((product.raw as { images?: { file?: string }[] }).images ?? []).flatMap((image) => (image.file ? [image.file] : []));
const hasPickList = (product: SampleProduct): boolean => ((product.raw as { modifiers?: { type?: string }[] }).modifiers ?? []).some((modifier) => modifier.type === "product_list" || modifier.type === "product_list_with_images");

export function uploadSource(storeHash: string | undefined, sample: BundleSample): ImportSource {
  const total = sample.catalog?.products.length ?? 0;

  return {
    name: sample.name,
    version: sample.version,
    productCount: total,
    manifest: sample.manifest,
    languages: sample.languages,
    defaultLanguage: sample.defaultLanguage,
    importBatch: async (offset) => {
      const products: SampleProduct[] = [];
      const images: { file: string; base64: string }[] = [];
      let bytes = 0;

      for (const product of sample.products(offset, BATCH_PRODUCTS)) {
        const pictures = imageFiles(product).map((file) => ({ file, data: sample.image(file) })).filter((entry): entry is { file: string; data: Uint8Array } => entry.data !== undefined);
        const size = pictures.reduce((sum, entry) => sum + entry.data.length, 0);

        // Always send at least one product, even if its pictures alone fill a request.
        if (products.length > 0 && bytes + size > BATCH_IMAGE_BYTES) break;

        products.push(product);

        for (const entry of pictures) {
          if (bytes + entry.data.length > BATCH_IMAGE_BYTES && images.length > 0) continue;

          bytes += entry.data.length;
          images.push({ file: entry.file, base64: toBase64(entry.data) });
        }
      }

      if (products.length === 0) return { ok: false, message: "The snapshot has no more products." };

      return importUploadBatchAction(storeHash, { label: `${sample.name} ${sample.version}`, total, offset, products, images });
    },
    finishPickLists: async (offset) => {
      const page = sample.products(offset, PICK_LIST_PAGE);
      const result = await finishUploadPickListsAction(storeHash, { products: page.filter(hasPickList) });

      return result.ok ? { ok: true, nextOffset: offset + page.length, done: offset + page.length >= total || page.length === 0, created: result.created, warnings: result.warnings } : result;
    },
    importSection: async (id) => {
      const entry = sample.manifest.sections[id];

      if (!entry) return { ok: false, message: "That section isn't in this snapshot." };

      try {
        return await importUploadSectionAction(storeHash, { label: `${sample.name} ${sample.version}`, section: id, data: sample.section(entry.file) });
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Couldn't read that section." };
      }
    },
  };
}
