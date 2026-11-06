import "server-only";
import { buildPackPreview, parsePreview } from "@/lib/app-data/preview";
import type { ActivityEntry, AppDataStore, ImagesState, Pack, PackPreview, PackProduct, PackSummary } from "@/lib/app-data/types";
import { getPool } from "@/lib/credentials-store/postgres-driver/get-pool";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

async function guard<T>(context: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logError(`PostgresAppDataStore: ${context}`, error);
    throw new AppError("DATABASE", "A database error occurred.", { cause: error });
  }
}

const PRODUCT_CHUNK = 100;

interface PackRow {
  id: string;
  name: string;
  description: string;
  source: PackSummary["source"];
  created_by_email: string | null;
  created_at: Date;
  published_at: Date | null;
  published_by: string | null;
  preview: unknown;
  images_state: ImagesState;
  product_count?: string;
}

interface ActivityRow {
  id: string;
  store_hash: string | null;
  user_email: string | null;
  kind: string;
  summary: string;
  status: ActivityEntry["status"];
  undo: Record<string, unknown> | null;
  created_at: Date;
}

function toSummary(row: PackRow): PackSummary {
  return { id: row.id, name: row.name, description: row.description, source: row.source, productCount: Number(row.product_count ?? 0), createdByEmail: row.created_by_email, createdAt: row.created_at.toISOString(), publishedAt: row.published_at ? row.published_at.toISOString() : null, publishedBy: row.published_by, preview: parsePreview(row.preview), imagesState: row.images_state ?? "skipped" };
}

function toActivity(row: ActivityRow): ActivityEntry {
  return { id: row.id, storeHash: row.store_hash, userEmail: row.user_email, kind: row.kind, summary: row.summary, status: row.status, createdAt: row.created_at.toISOString(), undo: row.undo ?? undefined };
}

// Deployment driver. Schema comes from node-pg-migrate (0003_app_data.sql).
export class PostgresAppDataStore implements AppDataStore {
  async listPacks(options: { published?: boolean; includeBackups?: boolean } = {}): Promise<PackSummary[]> {
    const where: string[] = [];

    if (options.published !== undefined) where.push(options.published ? "p.published_at IS NOT NULL" : "p.published_at IS NULL");
    if (options.includeBackups === false) where.push("p.source <> 'backup'");

    return guard("listPacks", async () => {
      const { rows } = await getPool().query<PackRow>(`SELECT p.*, (SELECT COUNT(*) FROM pack_products WHERE pack_id = p.id) AS product_count FROM packs p ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.created_at DESC`);

      return rows.map(toSummary);
    });
  }

  async publishPack(id: string, input: { publishedBy: string; description?: string }): Promise<PackSummary | undefined> {
    return guard("publishPack", async () => {
      const { rows } = await getPool().query<PackRow>(
        `UPDATE packs SET published_at = now(), published_by = $2, description = COALESCE($3, description)
         WHERE id = $1 AND source <> 'backup'
         RETURNING *, (SELECT COUNT(*) FROM pack_products WHERE pack_id = packs.id) AS product_count`,
        [id, input.publishedBy, input.description ?? null],
      );

      return rows[0] ? toSummary(rows[0]) : undefined;
    });
  }

  async unpublishPack(id: string): Promise<void> {
    await guard("unpublishPack", async () => {
      await getPool().query("UPDATE packs SET published_at = NULL, published_by = NULL WHERE id = $1", [id]);
    });
  }

  async getPack(id: string): Promise<Pack | undefined> {
    return guard("getPack", async () => {
      const pool = getPool();
      const { rows } = await pool.query<PackRow>("SELECT * FROM packs WHERE id = $1", [id]);

      if (!rows[0]) return undefined;

      const products = await pool.query<{ payload: PackProduct }>("SELECT payload FROM pack_products WHERE pack_id = $1 ORDER BY position", [id]);

      return { ...toSummary(rows[0]), productCount: products.rows.length, products: products.rows.map((row) => row.payload) };
    });
  }

  async getPackPage(id: string, offset: number, limit: number): Promise<{ pack: PackSummary; products: PackProduct[] } | undefined> {
    return guard("getPackPage", async () => {
      const pool = getPool();
      const { rows } = await pool.query<PackRow>("SELECT p.*, (SELECT COUNT(*) FROM pack_products WHERE pack_id = p.id) AS product_count FROM packs p WHERE p.id = $1", [id]);

      if (!rows[0]) return undefined;

      const products = await pool.query<{ payload: PackProduct }>("SELECT payload FROM pack_products WHERE pack_id = $1 ORDER BY position LIMIT $2 OFFSET $3", [id, limit, offset]);

      return { pack: toSummary(rows[0]), products: products.rows.map((row) => row.payload) };
    });
  }

  async savePack(input: Omit<Pack, "id" | "createdAt" | "productCount" | "publishedAt" | "publishedBy" | "preview" | "imagesState"> & { imagesState?: ImagesState }): Promise<PackSummary> {
    return guard("savePack", async () => {
      const client = await getPool().connect();

      try {
        await client.query("BEGIN");

        const { rows } = await client.query<PackRow>("INSERT INTO packs (name, description, source, created_by_email, preview, images_state) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *", [input.name, input.description, input.source, input.createdByEmail, JSON.stringify(buildPackPreview(input.products)), input.imagesState ?? "skipped"]);
        const pack = rows[0];

        for (let start = 0; start < input.products.length; start += PRODUCT_CHUNK) {
          const chunk = input.products.slice(start, start + PRODUCT_CHUNK);
          const values: unknown[] = [pack.id];
          const placeholders = chunk.map((product, index) => {
            values.push(start + index, JSON.stringify(product));

            return `($1, $${values.length - 1}, $${values.length}::jsonb)`;
          });

          await client.query(`INSERT INTO pack_products (pack_id, position, payload) VALUES ${placeholders.join(", ")}`, values);
        }

        await client.query("COMMIT");

        return { ...toSummary(pack), productCount: input.products.length };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async updatePackProducts(packId: string, offset: number, products: PackProduct[]): Promise<void> {
    await guard("updatePackProducts", async () => {
      const client = await getPool().connect();

      try {
        await client.query("BEGIN");

        for (const [index, product] of products.entries()) {
          await client.query("UPDATE pack_products SET payload = $3::jsonb WHERE pack_id = $1 AND position = $2", [packId, offset + index, JSON.stringify(product)]);
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async setPackImages(packId: string, state: ImagesState, preview: PackPreview): Promise<void> {
    await guard("setPackImages", async () => {
      await getPool().query("UPDATE packs SET images_state = $2, preview = $3::jsonb WHERE id = $1", [packId, state, JSON.stringify(preview)]);
    });
  }

  async deletePack(id: string): Promise<void> {
    await guard("deletePack", async () => {
      await getPool().query("DELETE FROM packs WHERE id = $1", [id]);
    });
  }

  async listActivity(options: { storeHash?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
    const { storeHash, limit = 100 } = options;

    return guard("listActivity", async () => {
      const { rows } = storeHash
        ? await getPool().query<ActivityRow>("SELECT * FROM activity_log WHERE store_hash = $1 ORDER BY created_at DESC LIMIT $2", [storeHash, limit])
        : await getPool().query<ActivityRow>("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1", [limit]);

      return rows.map(toActivity);
    });
  }

  async logActivity(entry: Omit<ActivityEntry, "id" | "createdAt">): Promise<ActivityEntry> {
    return guard("logActivity", async () => {
      const { rows } = await getPool().query<ActivityRow>("INSERT INTO activity_log (store_hash, user_email, kind, summary, status, undo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [entry.storeHash, entry.userEmail, entry.kind, entry.summary, entry.status, entry.undo ? JSON.stringify(entry.undo) : null]);

      return toActivity(rows[0]);
    });
  }

  async recordDemoProducts(storeHash: string, productIds: number[], packId: string | null): Promise<void> {
    if (productIds.length === 0) return;

    await guard("recordDemoProducts", async () => {
      await getPool().query(
        `INSERT INTO demo_products (store_hash, product_id, pack_id) SELECT $1, unnest($2::bigint[]), $3
         ON CONFLICT (store_hash, product_id) DO UPDATE SET pack_id = excluded.pack_id`,
        [storeHash, productIds, packId],
      );
    });
  }

  async listDemoProductIds(storeHash: string): Promise<number[]> {
    return guard("listDemoProductIds", async () => {
      const { rows } = await getPool().query<{ product_id: string }>("SELECT product_id FROM demo_products WHERE store_hash = $1 ORDER BY product_id", [storeHash]);

      return rows.map((row) => Number(row.product_id));
    });
  }

  async forgetDemoProducts(storeHash: string, productIds: number[]): Promise<void> {
    if (productIds.length === 0) return;

    await guard("forgetDemoProducts", async () => {
      await getPool().query("DELETE FROM demo_products WHERE store_hash = $1 AND product_id = ANY($2::bigint[])", [storeHash, productIds]);
    });
  }

  async deleteStoreData(storeHash: string): Promise<void> {
    await guard("deleteStoreData", async () => {
      await getPool().query("DELETE FROM demo_products WHERE store_hash = $1", [storeHash]);
      await getPool().query("DELETE FROM activity_log WHERE store_hash = $1", [storeHash]);
    });
  }
}
