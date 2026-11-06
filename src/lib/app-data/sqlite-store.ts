import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildPackPreview, parsePreview } from "@/lib/app-data/preview";
import type { ActivityEntry, AppDataStore, AppDoc, ImagesState, Pack, PackPreview, PackProduct, PackSummary } from "@/lib/app-data/types";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_by_email TEXT,
    store_hash TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT,
    published_by TEXT,
    preview TEXT,
    images_state TEXT NOT NULL DEFAULT 'skipped'
  );
  CREATE TABLE IF NOT EXISTS pack_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id TEXT NOT NULL REFERENCES packs (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pack_products_pack_id_idx ON pack_products (pack_id, position);
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    store_hash TEXT,
    user_email TEXT,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    undo TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_log_store_created_idx ON activity_log (store_hash, created_at DESC);
  CREATE TABLE IF NOT EXISTS demo_products (
    store_hash TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    pack_id TEXT REFERENCES packs (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (store_hash, product_id)
  );
  CREATE TABLE IF NOT EXISTS app_docs (
    collection TEXT NOT NULL,
    store_hash TEXT NOT NULL,
    id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (collection, store_hash, id)
  );
`;

const DEFAULT_PATH = "./data/app-data.sqlite";

function guard<T>(context: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    logError(`SqliteAppDataStore: ${context}`, error);
    throw new AppError("DATABASE", "A database error occurred.", { cause: error });
  }
}

// CREATE TABLE IF NOT EXISTS leaves an older file's tables as they were, so
// columns added since are applied here.
function addMissingColumns(db: DatabaseSync): void {
  const have = new Set((db.prepare("PRAGMA table_info(packs)").all() as unknown as { name: string }[]).map((column) => column.name));

  if (!have.has("store_hash")) db.exec("ALTER TABLE packs ADD COLUMN store_hash TEXT");
  if (!have.has("published_at")) db.exec("ALTER TABLE packs ADD COLUMN published_at TEXT");
  if (!have.has("published_by")) db.exec("ALTER TABLE packs ADD COLUMN published_by TEXT");

  if (!have.has("images_state")) db.exec("ALTER TABLE packs ADD COLUMN images_state TEXT NOT NULL DEFAULT 'skipped'");

  if (!have.has("preview")) {
    db.exec("ALTER TABLE packs ADD COLUMN preview TEXT");

    // Packs saved before previews existed get one now, from their stored products.
    const update = db.prepare("UPDATE packs SET preview = ? WHERE id = ?");

    for (const { id } of db.prepare("SELECT id FROM packs").all() as unknown as { id: string }[]) {
      const products = (db.prepare("SELECT payload FROM pack_products WHERE pack_id = ? ORDER BY position").all(id) as unknown as { payload: string }[]).map((row) => JSON.parse(row.payload) as PackProduct);

      update.run(JSON.stringify(buildPackPreview(products)), id);
    }
  }
}

function inTransaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN");

  try {
    const result = run();

    db.exec("COMMIT");

    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

interface PackRow {
  id: string;
  name: string;
  description: string;
  source: PackSummary["source"];
  created_by_email: string | null;
  store_hash: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  preview: string | null;
  images_state: ImagesState;
  product_count?: number;
}

interface ActivityRow {
  id: string;
  store_hash: string | null;
  user_email: string | null;
  kind: string;
  summary: string;
  status: ActivityEntry["status"];
  undo: string | null;
  created_at: string;
}

function toSummary(row: PackRow): PackSummary {
  return { id: row.id, name: row.name, description: row.description, source: row.source, productCount: row.product_count ?? 0, createdByEmail: row.created_by_email, storeHash: row.store_hash ?? null, createdAt: row.created_at, publishedAt: row.published_at, publishedBy: row.published_by, preview: parsePreview(row.preview), imagesState: row.images_state ?? "skipped" };
}

function toActivity(row: ActivityRow): ActivityEntry {
  return { id: row.id, storeHash: row.store_hash, userEmail: row.user_email, kind: row.kind, summary: row.summary, status: row.status, createdAt: row.created_at, undo: row.undo ? (JSON.parse(row.undo) as Record<string, unknown>) : undefined };
}

// Local-development driver (single process, one file). Same contract as the
// Postgres driver, which is what deployments use.
export class SqliteAppDataStore implements AppDataStore {
  private readonly db: DatabaseSync;

  constructor(path: string = process.env.APP_DATA_SQLITE_PATH ?? DEFAULT_PATH) {
    this.db = guard("open", () => {
      mkdirSync(dirname(path), { recursive: true });

      const db = new DatabaseSync(path);

      db.exec("PRAGMA foreign_keys = ON");
      db.exec(SCHEMA);
      addMissingColumns(db);

      return db;
    });
  }

  async listPacks(options: { published?: boolean; includeBackups?: boolean; ownedBy?: string } = {}): Promise<PackSummary[]> {
    const where: string[] = [];
    const args: string[] = [];

    if (options.ownedBy !== undefined) {
      where.push("p.store_hash = ?");
      args.push(options.ownedBy);
    }

    if (options.published !== undefined) where.push(options.published ? "p.published_at IS NOT NULL" : "p.published_at IS NULL");
    if (options.includeBackups === false) where.push("p.source <> 'backup'");

    return guard("listPacks", () =>
      (this.db
        .prepare(`SELECT p.*, (SELECT COUNT(*) FROM pack_products WHERE pack_id = p.id) AS product_count FROM packs p ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.created_at DESC`)
        .all(...args) as unknown as PackRow[]).map(toSummary),
    );
  }

  async publishPack(id: string, input: { publishedBy: string; description?: string }): Promise<PackSummary | undefined> {
    return guard("publishPack", () => {
      const result = this.db
        .prepare("UPDATE packs SET published_at = ?, published_by = ?, description = COALESCE(?, description) WHERE id = ? AND source <> 'backup'")
        .run(new Date().toISOString(), input.publishedBy, input.description ?? null, id);

      if (Number(result.changes) === 0) return undefined;

      return toSummary(this.db.prepare("SELECT p.*, (SELECT COUNT(*) FROM pack_products WHERE pack_id = p.id) AS product_count FROM packs p WHERE p.id = ?").get(id) as unknown as PackRow);
    });
  }

  async unpublishPack(id: string): Promise<void> {
    guard("unpublishPack", () => {
      this.db.prepare("UPDATE packs SET published_at = NULL, published_by = NULL WHERE id = ?").run(id);
    });
  }

  async getPack(id: string): Promise<Pack | undefined> {
    return guard("getPack", () => {
      const row = this.db.prepare("SELECT * FROM packs WHERE id = ?").get(id) as unknown as PackRow | undefined;

      if (!row) return undefined;

      const products = (this.db.prepare("SELECT payload FROM pack_products WHERE pack_id = ? ORDER BY position").all(id) as unknown as { payload: string }[]).map((r) => JSON.parse(r.payload) as PackProduct);

      return { ...toSummary(row), productCount: products.length, products };
    });
  }

  async getPackPage(id: string, offset: number, limit: number): Promise<{ pack: PackSummary; products: PackProduct[] } | undefined> {
    return guard("getPackPage", () => {
      const row = this.db.prepare("SELECT p.*, (SELECT COUNT(*) FROM pack_products WHERE pack_id = p.id) AS product_count FROM packs p WHERE p.id = ?").get(id) as unknown as PackRow | undefined;

      if (!row) return undefined;

      const products = (this.db.prepare("SELECT payload FROM pack_products WHERE pack_id = ? ORDER BY position LIMIT ? OFFSET ?").all(id, limit, offset) as unknown as { payload: string }[]).map((r) => JSON.parse(r.payload) as PackProduct);

      return { pack: toSummary(row), products };
    });
  }

  async savePack(input: Omit<Pack, "id" | "createdAt" | "productCount" | "publishedAt" | "publishedBy" | "preview" | "imagesState"> & { imagesState?: ImagesState }): Promise<PackSummary> {
    return guard("savePack", () => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const preview = buildPackPreview(input.products);
      const imagesState = input.imagesState ?? "skipped";

      inTransaction(this.db, () => {
        this.db.prepare("INSERT INTO packs (id, name, description, source, created_by_email, store_hash, created_at, preview, images_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.name, input.description, input.source, input.createdByEmail, input.storeHash, createdAt, JSON.stringify(preview), imagesState);

        const insert = this.db.prepare("INSERT INTO pack_products (pack_id, position, payload) VALUES (?, ?, ?)");

        input.products.forEach((product, index) => insert.run(id, index, JSON.stringify(product)));
      });

      return { id, name: input.name, description: input.description, source: input.source, productCount: input.products.length, createdByEmail: input.createdByEmail, storeHash: input.storeHash, createdAt, publishedAt: null, publishedBy: null, preview, imagesState };
    });
  }

  async updatePackProducts(packId: string, offset: number, products: PackProduct[]): Promise<void> {
    guard("updatePackProducts", () => {
      const update = this.db.prepare("UPDATE pack_products SET payload = ? WHERE pack_id = ? AND position = ?");

      inTransaction(this.db, () => products.forEach((product, index) => update.run(JSON.stringify(product), packId, offset + index)));
    });
  }

  async setPackImages(packId: string, state: ImagesState, preview: PackPreview): Promise<void> {
    guard("setPackImages", () => {
      this.db.prepare("UPDATE packs SET images_state = ?, preview = ? WHERE id = ?").run(state, JSON.stringify(preview), packId);
    });
  }

  async deletePack(id: string): Promise<void> {
    guard("deletePack", () => {
      this.db.prepare("DELETE FROM packs WHERE id = ?").run(id);
    });
  }

  async listActivity(options: { storeHash?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
    const { storeHash, limit = 100 } = options;

    return guard("listActivity", () => {
      const rows = (storeHash
        ? this.db.prepare("SELECT * FROM activity_log WHERE store_hash = ? ORDER BY created_at DESC LIMIT ?").all(storeHash, limit)
        : this.db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?").all(limit)) as unknown as ActivityRow[];

      return rows.map(toActivity);
    });
  }

  async logActivity(entry: Omit<ActivityEntry, "id" | "createdAt">): Promise<ActivityEntry> {
    return guard("logActivity", () => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      this.db.prepare("INSERT INTO activity_log (id, store_hash, user_email, kind, summary, status, undo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, entry.storeHash, entry.userEmail, entry.kind, entry.summary, entry.status, entry.undo ? JSON.stringify(entry.undo) : null, createdAt);

      return { ...entry, id, createdAt };
    });
  }

  async recordDemoProducts(storeHash: string, productIds: number[], packId: string | null): Promise<void> {
    guard("recordDemoProducts", () => {
      const insert = this.db.prepare("INSERT INTO demo_products (store_hash, product_id, pack_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_hash, product_id) DO UPDATE SET pack_id = excluded.pack_id");
      const now = new Date().toISOString();

      inTransaction(this.db, () => productIds.forEach((id) => insert.run(storeHash, id, packId, now)));
    });
  }

  async listDemoProductIds(storeHash: string): Promise<number[]> {
    return guard("listDemoProductIds", () => (this.db.prepare("SELECT product_id FROM demo_products WHERE store_hash = ? ORDER BY product_id").all(storeHash) as unknown as { product_id: number }[]).map((row) => row.product_id));
  }

  async forgetDemoProducts(storeHash: string, productIds: number[]): Promise<void> {
    guard("forgetDemoProducts", () => {
      const remove = this.db.prepare("DELETE FROM demo_products WHERE store_hash = ? AND product_id = ?");

      inTransaction(this.db, () => productIds.forEach((id) => remove.run(storeHash, id)));
    });
  }

  async putDoc(collection: string, storeHash: string, id: string, body: unknown): Promise<void> {
    guard("putDoc", () => {
      this.db.prepare("INSERT INTO app_docs (collection, store_hash, id, body, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, store_hash, id) DO UPDATE SET body = excluded.body").run(collection, storeHash, id, JSON.stringify(body), new Date().toISOString());
    });
  }

  async getDoc(collection: string, storeHash: string, id: string): Promise<AppDoc | undefined> {
    return guard("getDoc", () => {
      const row = this.db.prepare("SELECT id, body, created_at FROM app_docs WHERE collection = ? AND store_hash = ? AND id = ?").get(collection, storeHash, id) as unknown as { id: string; body: string; created_at: string } | undefined;

      return row ? { id: row.id, createdAt: row.created_at, body: JSON.parse(row.body) } : undefined;
    });
  }

  async listDocs(collection: string, storeHash: string): Promise<AppDoc[]> {
    return guard("listDocs", () => (this.db.prepare("SELECT id, body, created_at FROM app_docs WHERE collection = ? AND store_hash = ? ORDER BY created_at, rowid").all(collection, storeHash) as unknown as { id: string; body: string; created_at: string }[]).map((row) => ({ id: row.id, createdAt: row.created_at, body: JSON.parse(row.body) })));
  }

  async deleteDocs(collection: string, storeHash: string, ids?: string[]): Promise<void> {
    guard("deleteDocs", () => {
      if (!ids) return void this.db.prepare("DELETE FROM app_docs WHERE collection = ? AND store_hash = ?").run(collection, storeHash);

      const remove = this.db.prepare("DELETE FROM app_docs WHERE collection = ? AND store_hash = ? AND id = ?");

      for (const id of ids) remove.run(collection, storeHash, id);
    });
  }

  async deleteStoreData(storeHash: string): Promise<void> {
    guard("deleteStoreData", () => {
      inTransaction(this.db, () => {
        this.db.prepare("DELETE FROM app_docs WHERE store_hash = ?").run(storeHash);
        this.db.prepare("DELETE FROM demo_products WHERE store_hash = ?").run(storeHash);
        this.db.prepare("DELETE FROM activity_log WHERE store_hash = ?").run(storeHash);
      });
    });
  }
}
