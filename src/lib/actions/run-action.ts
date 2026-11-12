import "server-only";
import { z } from "zod";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import type { AppDataStore } from "@/lib/app-data/types";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { getB2bClient } from "@/lib/bc-api-client/b2b-client";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import type { OpsContext } from "@/lib/catalog/operations";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { getCurrentUserEmail } from "@/lib/session/current-user";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

// Expected failures come back as {ok:false, message} so the UI can show them;
// Server Actions never throw for those.
export type Outcome<T> = ({ ok: true } & T) | { ok: false; message: string };

export interface LocalContext {
  data: AppDataStore;
  storeHash: string;
  userEmail: string | null;
}

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();

async function authorize(storeHash: unknown): Promise<{ ok: true; hash: string | undefined } | { ok: false; message: string }> {
  const hash = storeHashSchema.safeParse(storeHash);

  if (!hash.success) return { ok: false, message: "Invalid store." };
  if (!(await isAuthorizedForStore(hash.data))) return { ok: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  return { ok: true, hash: hash.data };
}

function failure(context: string, error: unknown): { ok: false; message: string } {
  logError(context, error);

  return { ok: false, message: error instanceof AppError ? (error.detail ?? error.message) : "Something went wrong. Check the server logs." };
}

async function localContext(hash: string | undefined): Promise<LocalContext> {
  return { data: getAppDataStore(), storeHash: hash ?? process.env.STATIC_STORE_HASH ?? "static", userEmail: (await getCurrentUserEmail()) ?? null };
}

// For actions that only touch this app's own data (packs, activity). Works in
// every data mode.
export async function runLocalAction<T>(storeHash: unknown, context: string, work: (ctx: LocalContext) => Promise<T>): Promise<Outcome<T>> {
  const auth = await authorize(storeHash);

  if (!auth.ok) return auth;

  try {
    return { ok: true, ...(await work(await localContext(auth.hash))) };
  } catch (error) {
    return failure(context, error);
  }
}

// For actions that read or change the SE's BigCommerce store. Refused in demo
// (MOCK) mode, which has no store behind it.
export async function runStoreAction<T>(storeHash: unknown, context: string, work: (ctx: OpsContext) => Promise<T>): Promise<Outcome<T>> {
  const auth = await authorize(storeHash);

  if (!auth.ok) return auth;
  if (getDataMode() === "MOCK") return { ok: false, message: "Demo data mode has no store to change. Use DATA_MODE=STATIC or install the app." };

  try {
    const local = await localContext(auth.hash);

    return { ok: true, ...(await work({ ...local, client: await getRestApiClient(auth.hash), b2b: () => getB2bClient(auth.hash) })) };
  } catch (error) {
    return failure(context, error);
  }
}
