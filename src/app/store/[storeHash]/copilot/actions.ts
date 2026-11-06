"use server";

import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { applyDraftToStore, setPromotionStatus } from "@/lib/copilot/apply";
import { draftSchema } from "@/lib/copilot/draft-spec";
import { signEnable, verifyDraft, verifyEnable } from "@/lib/copilot/draft-token";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();

export interface DraftActionResult extends ActionResult {
  promotionId?: number;
  created?: boolean;
  // Lets the "Enable now" button turn on only the promotion this draft created.
  enableToken?: string;
}

function failure(error: unknown, context: string): ActionResult {
  logError(context, error);

  return {
    success: false,
    message: error instanceof AppError ? error.message : error instanceof Error ? error.message : "BigCommerce didn't accept the change. Nothing was saved.",
  };
}

// Runs only after the person presses Apply on a draft card. The draft is
// re-validated here: the browser is not trusted to send well-formed specs.
export async function applyCopilotDraft(storeHash: unknown, draft: unknown, token: unknown): Promise<DraftActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);
  const parsed = draftSchema.safeParse(draft);

  if (!hash.success || !parsed.success) return { success: false, message: "That draft wasn't valid. Ask the copilot to draft it again." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  // Only drafts this server proposed for this store, recently, can be applied.
  if (!verifyDraft(token, hash.data, parsed.data)) {
    return { success: false, message: "This draft has expired or can't be verified. Ask the copilot to draft it again." };
  }

  try {
    const outcome = await applyDraftToStore(parsed.data, hash.data);

    return { success: true, message: outcome.message, promotionId: outcome.promotionId, created: outcome.created, ...(outcome.created && { enableToken: signEnable(hash.data, outcome.promotionId) }) };
  } catch (error) {
    return failure(error, "applyCopilotDraft");
  }
}

// The explicit "Enable now" button on a created draft.
export async function setPromotionEnabled(storeHash: unknown, id: unknown, enabled: unknown, token?: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);
  const promotionId = z.number().int().positive().safeParse(id);

  if (!hash.success || !promotionId.success || typeof enabled !== "boolean") return { success: false, message: "Invalid request." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  if (enabled && !verifyEnable(token, hash.data, promotionId.data)) return { success: false, message: "Enable it from the draft card that created it, or in BigCommerce." };

  try {
    return { success: true, message: await setPromotionStatus(promotionId.data, enabled ? "ENABLED" : "DISABLED", hash.data) };
  } catch (error) {
    return failure(error, "setPromotionEnabled");
  }
}
