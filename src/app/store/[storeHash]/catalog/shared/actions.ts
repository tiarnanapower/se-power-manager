"use server";

import { z } from "zod";
import { type Outcome, runLocalAction } from "@/lib/actions/run-action";
import type { PackSummary } from "@/lib/app-data/types";
import { AppError } from "@/lib/errors/app-error";

const packId = z.string().min(1).max(64);

// Lists one of the SE's saved packs in the Shared Catalog under the name they
// type. Works in every data mode: it only touches this app's own data.
export async function publishPackAction(storeHash: unknown, input: unknown): Promise<Outcome<{ pack: PackSummary }>> {
  const parsed = z
    .object({
      packId,
      publishedBy: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, message: "Add your name (up to 80 characters) and keep the description under 500." };

  return runLocalAction(storeHash, "publishPackAction", async (ctx) => {
    const existing = await ctx.data.getPackPage(parsed.data.packId, 0, 1);

    if (!existing) throw new AppError("NOT_FOUND", "That pack no longer exists.");
    if (existing.pack.source === "backup") throw new AppError("VALIDATION", "Automatic backups can't be published. Save the catalog as a pack first.");
    if (existing.pack.publishedAt) throw new AppError("VALIDATION", "That pack is already in the Shared Catalog.");

    const pack = await ctx.data.publishPack(parsed.data.packId, { publishedBy: parsed.data.publishedBy, description: parsed.data.description });

    if (!pack) throw new AppError("NOT_FOUND", "That pack can't be published.");

    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "catalog.publish-pack", summary: `Published "${pack.name}" to the Shared Catalog as ${parsed.data.publishedBy}.`, status: "success" });

    return { pack };
  });
}

// Only whoever saved the pack (or anyone, if no owner was recorded) can take it
// back out; the pack itself stays in the library.
export async function unpublishPackAction(storeHash: unknown, input: unknown): Promise<Outcome<{ unpublished: true }>> {
  const parsed = z.object({ packId }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Invalid request." };

  return runLocalAction(storeHash, "unpublishPackAction", async (ctx) => {
    const existing = await ctx.data.getPackPage(parsed.data.packId, 0, 1);

    if (!existing) throw new AppError("NOT_FOUND", "That pack no longer exists.");
    if (existing.pack.createdByEmail && existing.pack.createdByEmail !== ctx.userEmail) throw new AppError("AUTH", `Only ${existing.pack.createdByEmail} can remove this pack from the Shared Catalog.`);

    await ctx.data.unpublishPack(parsed.data.packId);
    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "catalog.unpublish-pack", summary: `Removed "${existing.pack.name}" from the Shared Catalog.`, status: "success" });

    return { unpublished: true as const };
  });
}
