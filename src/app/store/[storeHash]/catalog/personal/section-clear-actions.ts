"use server";

import { z } from "zod";
import { type Outcome, runStoreAction } from "@/lib/actions/run-action";
import { CLEARABLE_SECTIONS, clearSectionStep, previewClearSection, type ClearPreviewItem, type ClearStep } from "@/lib/samples/sections/clear";

const section = z.enum(CLEARABLE_SECTIONS);

export async function previewSectionsClearAction(storeHash: unknown, input: unknown): Promise<Outcome<{ previews: Record<string, ClearPreviewItem> }>> {
  const parsed = z.object({ sections: z.array(section).min(1).max(CLEARABLE_SECTIONS.length) }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "previewSectionsClearAction", async (ctx) => {
    const previews: Record<string, ClearPreviewItem> = {};

    for (const id of parsed.data.sections) previews[id] = await previewClearSection(ctx.client, id, { b2b: ctx.b2b });

    return { previews };
  });
}

// Removes a few items of one section. The page calls it again until nothing is left to remove.
export async function clearSectionStepAction(storeHash: unknown, input: unknown): Promise<Outcome<{ step: ClearStep }>> {
  const parsed = z.object({ section, confirmation: z.literal("DELETE") }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runStoreAction(storeHash, "clearSectionStepAction", async (ctx) => {
    const step = await clearSectionStep(ctx.client, parsed.data.section, { b2b: ctx.b2b });

    if (step.deleted > 0 || step.warnings.length > 0) {
      await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: `clear.${parsed.data.section}`, summary: `Cleared ${step.deleted} item${step.deleted === 1 ? "" : "s"} from ${parsed.data.section}${step.warnings.length ? `, ${step.warnings.length} couldn't be removed` : ""}.`, status: step.warnings.length ? "partial" : "success" });
    }

    return { step };
  });
}
