// Imports one non-catalog section into the store and records it in the activity log. Shared by the
// Store Templates (data read from the repo) and uploaded snapshots (data read from the zip).
import type { OpsContext } from "@/lib/catalog/operations";
import { AppError } from "@/lib/errors/app-error";
import { isSectionModule, SECTION_MODULES } from "@/lib/samples/sections";
import type { SectionResult } from "@/lib/samples/sections/shared";

export async function runSectionImport(ctx: OpsContext, section: string, data: unknown, label: string, options: { defaultLanguage?: string } = {}): Promise<SectionResult> {
  if (!isSectionModule(section)) throw new AppError("VALIDATION", "That section can't be imported yet.", { detail: "That section can't be imported yet." });

  const result = await SECTION_MODULES[section]!.import(ctx.client, data as never, { b2b: ctx.b2b, defaultLanguage: options.defaultLanguage });

  await ctx.data.logActivity({
    storeHash: ctx.storeHash,
    userEmail: ctx.userEmail,
    kind: "samples.import-section",
    summary: `Imported ${section} from ${label}: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.warnings.length ? `, ${result.warnings.length} warnings` : ""}.`,
    status: result.warnings.length ? "partial" : "success",
  });

  return result;
}
