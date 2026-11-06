import { randomUUID } from "node:crypto";
import { buildPackPreview } from "@/lib/app-data/preview";
import type { ActivityEntry, AppDataStore, AppDoc, Pack, PackSummary } from "@/lib/app-data/types";

interface MemoryState {
  packs: Map<string, Pack>;
  activity: ActivityEntry[];
  demoProducts: Map<string, Set<number>>;
  docs: Map<string, AppDoc>;
}

// Survives dev-server module reloads. Not durable and not shared between
// instances: used by tests only. Real runs use the SQLite or Postgres store.
const globalState = globalThis as unknown as { __sePowerManagerMemory?: MemoryState };

function state(): MemoryState {
  globalState.__sePowerManagerMemory ??= { packs: new Map(), activity: [], demoProducts: new Map(), docs: new Map() };

  return globalState.__sePowerManagerMemory;
}

function summarize(pack: Pack): PackSummary {
  const { products: _products, ...summary } = pack;

  return summary;
}

const docKey = (collection: string, storeHash: string, id: string) => `${collection}\u0000${storeHash}\u0000${id}`;

export const memoryAppDataStore: AppDataStore = {
  async putDoc(collection, storeHash, id, body) {
    const key = docKey(collection, storeHash, id);

    state().docs.set(key, { id, createdAt: state().docs.get(key)?.createdAt ?? new Date().toISOString(), body: JSON.parse(JSON.stringify(body)) });
  },

  async getDoc(collection, storeHash, id) {
    return state().docs.get(docKey(collection, storeHash, id));
  },

  async listDocs(collection, storeHash) {
    const prefix = docKey(collection, storeHash, "");

    return [...state().docs.entries()].filter(([key]) => key.startsWith(prefix)).map(([, doc]) => doc).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async deleteDocs(collection, storeHash, ids) {
    const prefix = docKey(collection, storeHash, "");

    for (const key of [...state().docs.keys()]) if (key.startsWith(prefix) && (!ids || ids.includes(key.slice(prefix.length)))) state().docs.delete(key);
  },

  async listPacks(options = {}) {
    return [...state().packs.values()]
      .filter((pack) => options.published === undefined || (pack.publishedAt !== null) === options.published)
      .filter((pack) => options.includeBackups !== false || pack.source !== "backup")
      .map(summarize)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async updatePackProducts(packId, offset, products) {
    const pack = state().packs.get(packId);

    products.forEach((product, index) => {
      if (pack && offset + index < pack.products.length) pack.products[offset + index] = product;
    });
  },

  async setPackImages(packId, imagesState, preview) {
    const pack = state().packs.get(packId);

    if (pack) {
      pack.imagesState = imagesState;
      pack.preview = preview;
    }
  },

  async publishPack(id, input) {
    const pack = state().packs.get(id);

    if (!pack || pack.source === "backup") return undefined;

    pack.publishedAt = new Date().toISOString();
    pack.publishedBy = input.publishedBy;
    if (input.description !== undefined) pack.description = input.description;

    return summarize(pack);
  },

  async unpublishPack(id) {
    const pack = state().packs.get(id);

    if (pack) {
      pack.publishedAt = null;
      pack.publishedBy = null;
    }
  },

  async getPack(id) {
    return state().packs.get(id);
  },

  async getPackPage(id, offset, limit) {
    const pack = state().packs.get(id);

    return pack ? { pack: summarize(pack), products: pack.products.slice(offset, offset + limit) } : undefined;
  },

  async savePack(input) {
    const pack: Pack = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), productCount: input.products.length, publishedAt: null, publishedBy: null, preview: buildPackPreview(input.products), imagesState: input.imagesState ?? "skipped" };

    state().packs.set(pack.id, pack);

    return summarize(pack);
  },

  async deletePack(id) {
    state().packs.delete(id);
  },

  async listActivity(options = {}) {
    const { storeHash, limit = 100 } = options;

    return state()
      .activity.filter((entry) => !storeHash || entry.storeHash === storeHash)
      .slice(0, limit);
  },

  async logActivity(entry) {
    const full: ActivityEntry = { ...entry, id: randomUUID(), createdAt: new Date().toISOString() };

    state().activity.unshift(full);

    return full;
  },

  async recordDemoProducts(storeHash, productIds) {
    const set = state().demoProducts.get(storeHash) ?? new Set<number>();

    productIds.forEach((id) => set.add(id));
    state().demoProducts.set(storeHash, set);
  },

  async listDemoProductIds(storeHash) {
    return [...(state().demoProducts.get(storeHash) ?? [])].sort((a, b) => a - b);
  },

  async forgetDemoProducts(storeHash, productIds) {
    const set = state().demoProducts.get(storeHash);

    productIds.forEach((id) => set?.delete(id));
  },

  async deleteStoreData(storeHash) {
    state().demoProducts.delete(storeHash);
    state().activity = state().activity.filter((entry) => entry.storeHash !== storeHash);

    for (const key of [...state().docs.keys()]) if (key.split("\u0000")[1] === storeHash) state().docs.delete(key);
  },
};
