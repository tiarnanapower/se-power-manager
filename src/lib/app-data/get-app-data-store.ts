import "server-only";
import { PostgresAppDataStore } from "@/lib/app-data/postgres-store";
import { SqliteAppDataStore } from "@/lib/app-data/sqlite-store";
import type { AppDataStore } from "@/lib/app-data/types";
import { AppError } from "@/lib/errors/app-error";

let instance: AppDataStore | undefined;

// Follows CREDENTIALS_STORE_DRIVER so one setting picks the database for
// everything: SQLITE (local file, default) or POSTGRES (Vercel + Neon). D1 is
// not supported for app data.
export function getAppDataStore(): AppDataStore {
  if (instance) return instance;

  const driver = process.env.CREDENTIALS_STORE_DRIVER?.toUpperCase() ?? "SQLITE";

  // Vercel's filesystem is read-only and per-instance, so a local SQLite file can't work there.
  if (process.env.VERCEL && driver === "SQLITE") throw new AppError("DATABASE", "Set CREDENTIALS_STORE_DRIVER=POSTGRES (and DATABASE_URL) in the Vercel environment variables, then redeploy.");

  if (driver === "POSTGRES") instance = new PostgresAppDataStore();
  else if (driver === "SQLITE") instance = new SqliteAppDataStore();
  else throw new AppError("DATABASE", "Packs and activity need CREDENTIALS_STORE_DRIVER to be SQLITE or POSTGRES.");

  return instance;
}
