"use server";

import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { countBigGearCompanies } from "@/lib/big-gear/b2b-api";
import { getBigGearStatus } from "@/lib/big-gear/config";
import { listBigGearProducts } from "@/lib/big-gear/products-api";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();

// Read-only check that the SE's own store credentials work.
export async function testConnection(storeHash: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);

  if (!hash.success) return { success: false, message: "Invalid store." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  try {
    const client = await getRestApiClient(hash.data);
    const { data } = await client.get<{ name?: string }>("/v2/store");

    return { success: true, message: `Connected to ${data?.name ?? "your store"}.` };
  } catch (error) {
    logError("testConnection", error);

    return { success: false, message: error instanceof AppError ? error.message : "Couldn't reach BigCommerce. Check the store hash, token and scopes." };
  }
}

// Read-only check of the shared Big Gear store and its B2B API.
export async function testBigGearConnection(storeHash: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);

  if (!hash.success) return { success: false, message: "Invalid store." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  if (!getBigGearStatus().storeConfigured) return { success: false, message: "Big Gear isn't configured on the server." };

  try {
    const products = await listBigGearProducts({ limit: 1 });
    const [b2b] = await Promise.allSettled([countBigGearCompanies()]);
    const b2bText = b2b.status === "fulfilled" ? "B2B API reachable." : "B2B API not reachable (check the B2B Edition scope).";

    return { success: true, message: `Big Gear connected: ${products.total} products. ${b2bText}` };
  } catch (error) {
    logError("testBigGearConnection", error);

    return { success: false, message: error instanceof AppError ? error.message : "Couldn't reach the Big Gear store." };
  }
}
