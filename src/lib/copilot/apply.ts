// Server-only: writes a CONFIRMED draft to the store. Called only from the
// authorized server actions, after the person pressed Apply.
import "server-only";
import { applyPatch, compileCreate, type Draft } from "@/lib/copilot/draft-spec";
import { logAudit } from "@/lib/errors/logger";
import { fetchStoreInfo } from "@/lib/store/store-info-api";
import { createCouponCode, createPromotion, fetchPromotion, updatePromotion } from "@/lib/promotions/promotions-api";

export interface ApplyOutcome {
  promotionId: number;
  message: string;
  created: boolean;
}

export async function applyDraftToStore(draft: Draft, storeHash: string | undefined): Promise<ApplyOutcome> {
  const { timeZone } = await fetchStoreInfo(storeHash);

  if (draft.type === "create") {
    const created = await createPromotion(compileCreate(draft.spec, timeZone), storeHash);

    if (typeof created.id !== "number") throw new Error("BigCommerce didn't return the new promotion's id.");

    logAudit("promotion.create", { storeHash, promotionId: created.id, redemption: draft.spec.redemption, status: "DISABLED" });

    if (draft.spec.redemption === "COUPON" && draft.spec.couponCode) {
      try {
        await createCouponCode(created.id, { code: draft.spec.couponCode, ...(draft.spec.maxUses && { max_uses: draft.spec.maxUses }) }, storeHash);
        logAudit("promotion.coupon_code.create", { storeHash, promotionId: created.id });
      } catch {
        return { promotionId: created.id, created: true, message: `"${created.display_name || created.name}" was created (disabled), but its coupon code couldn't be added. Add the code in the control panel.` };
      }
    }

    return { promotionId: created.id, created: true, message: `"${created.display_name || created.name}" was created as disabled. Review it, then enable it when you're ready.` };
  }

  const current = await fetchPromotion(draft.id, storeHash);
  const next = applyPatch(current, draft.patch, timeZone);
  const saved = await updatePromotion(draft.id, next, storeHash);

  logAudit("promotion.update", { storeHash, promotionId: draft.id, fields: Object.keys(draft.patch) });

  return { promotionId: draft.id, created: false, message: `"${saved.display_name || saved.name}" was updated.` };
}

export async function setPromotionStatus(id: number, status: "ENABLED" | "DISABLED", storeHash: string | undefined): Promise<string> {
  const current = await fetchPromotion(id, storeHash);
  const saved = await updatePromotion(id, { ...current, status }, storeHash);

  logAudit("promotion.status", { storeHash, promotionId: id, status });

  return `"${saved.display_name || saved.name}" is now ${status === "ENABLED" ? "enabled" : "disabled"}.`;
}
