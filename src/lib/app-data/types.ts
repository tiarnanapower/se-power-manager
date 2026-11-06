// The app's own data (as opposed to per-store BigCommerce credentials, which
// live in lib/credentials-store). Packs and activity are shared by every SE
// who installs the app, so none of it is keyed to a single store.

// "backup" marks the pack saved automatically before a bulk clear; those can't
// be published.
export type PackSource = "store" | "scrape" | "big-gear" | "ai" | "backup";

// Whether a pack's product images have been copied to durable storage.
//   pending:   saved, copy not finished yet
//   preserved: every image is a durable copy (or the pack has no images)
//   partial:   copied what it could; some images were already gone
//   skipped:   not copied (no image storage configured, or an older pack): the
//              pack holds links to the source store's images, which BigCommerce
//              deletes along with the product
export type ImagesState = "pending" | "preserved" | "partial" | "skipped";

export interface PackPreview {
  // Up to four product image URLs, spread across the pack.
  images: string[];
  // Most common top-level categories.
  categories: string[];
  // The first few product names.
  names: string[];
}

export interface PackSummary {
  id: string;
  name: string;
  description: string;
  source: PackSource;
  productCount: number;
  createdByEmail: string | null;
  createdAt: string;
  // Set while the pack is listed in the Shared Catalog. publishedBy is the
  // display name the publisher chose, not an email.
  publishedAt: string | null;
  publishedBy: string | null;
  preview: PackPreview;
  imagesState: ImagesState;
}

// A product stored in a pack, in a store-agnostic shape. `raw` keeps the
// source payload (variants, options, modifiers, custom fields) for a faithful
// restore; images are kept as URLs and re-fetched by BigCommerce on import.
export interface PackProduct {
  name: string;
  sku: string | null;
  price: number | null;
  description: string | null;
  imageUrls: string[];
  categoryPaths: string[];
  raw: Record<string, unknown>;
}

export interface Pack extends PackSummary {
  products: PackProduct[];
}

export type ActivityStatus = "success" | "partial" | "failed";

export interface ActivityEntry {
  id: string;
  storeHash: string | null;
  userEmail: string | null;
  // e.g. "catalog.import", "catalog.clear", "big-gear.stencil-pull".
  kind: string;
  summary: string;
  status: ActivityStatus;
  createdAt: string;
  // Enough to undo the change, when it can be undone.
  undo?: Record<string, unknown>;
}

export type NewActivityEntry = Omit<ActivityEntry, "id" | "createdAt">;

// A small JSON document, scoped to one store. Used for queues that are
// worked on briefly (the Enrich Tool's analysis queue and its uploads) and
// small enough to filter in code.
export interface AppDoc {
  id: string;
  createdAt: string;
  body: unknown;
}

export interface AppDataStore {
  // Upserts a document (createdAt is kept when it already exists).
  putDoc(collection: string, storeHash: string, id: string, body: unknown): Promise<void>;
  getDoc(collection: string, storeHash: string, id: string): Promise<AppDoc | undefined>;
  // Oldest first.
  listDocs(collection: string, storeHash: string): Promise<AppDoc[]>;
  // Without ids, removes the whole collection for the store.
  deleteDocs(collection: string, storeHash: string, ids?: string[]): Promise<void>;
  // `published` filters by Shared Catalog state; omit for everything. Backups
  // are included unless `includeBackups` is false.
  listPacks(options?: { published?: boolean; includeBackups?: boolean }): Promise<PackSummary[]>;
  getPack(id: string): Promise<Pack | undefined>;
  // One slice of a pack's products, for restoring in batches.
  getPackPage(id: string, offset: number, limit: number): Promise<{ pack: PackSummary; products: PackProduct[] } | undefined>;
  // imagesState defaults to "skipped".
  savePack(pack: Omit<Pack, "id" | "createdAt" | "productCount" | "publishedAt" | "publishedBy" | "preview" | "imagesState"> & { imagesState?: ImagesState }): Promise<PackSummary>;
  // Replaces the products at positions offset, offset+1, ... (image copying rewrites URLs in place).
  updatePackProducts(packId: string, offset: number, products: PackProduct[]): Promise<void>;
  setPackImages(packId: string, state: ImagesState, preview: PackPreview): Promise<void>;
  deletePack(id: string): Promise<void>;
  // Lists a pack in the Shared Catalog. Returns undefined if it doesn't exist or
  // is a backup. Optionally replaces the description.
  publishPack(id: string, input: { publishedBy: string; description?: string }): Promise<PackSummary | undefined>;
  unpublishPack(id: string): Promise<void>;
  listActivity(options?: { storeHash?: string; limit?: number }): Promise<ActivityEntry[]>;
  logActivity(entry: NewActivityEntry): Promise<ActivityEntry>;
  // Products this app created in an SE's store, so "clear demo products" can
  // find exactly those (the BigCommerce API can't filter by origin).
  recordDemoProducts(storeHash: string, productIds: number[], packId: string | null): Promise<void>;
  listDemoProductIds(storeHash: string): Promise<number[]>;
  forgetDemoProducts(storeHash: string, productIds: number[]): Promise<void>;
  // Uninstall: drop everything keyed to this store. Packs are shared and stay.
  deleteStoreData(storeHash: string): Promise<void>;
}
