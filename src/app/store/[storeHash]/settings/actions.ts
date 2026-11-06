"use server";

import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { countPromotions } from "@/lib/promotions/promotions-api";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();

// Read-only check that the store credentials work and the token can read promotions.
export async function testConnection(storeHash: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);

  if (!hash.success) return { success: false, message: "Invalid store." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  try {
    const total = await countPromotions(hash.data);

    return { success: true, message: `Connected. This store has ${total} promotion${total === 1 ? "" : "s"}.` };
  } catch (error) {
    logError("testConnection", error);

    return {
      success: false,
      message: error instanceof AppError ? error.message : "Couldn't reach BigCommerce. Check the store hash, token and Marketing scope.",
    };
  }
}
