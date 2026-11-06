"use server";

import { type Outcome, runStoreAction } from "@/lib/actions/run-action";
import { scanStoreHealth, type ScanResult } from "@/lib/health/scan";

export async function scanHealthAction(storeHash: unknown): Promise<Outcome<{ report: ScanResult }>> {
  return runStoreAction(storeHash, "scanHealthAction", async (ctx) => {
    const report = await scanStoreHealth(ctx.client);

    await ctx.data.logActivity({ storeHash: ctx.storeHash, userEmail: ctx.userEmail, kind: "health.scan", summary: `Store health scan: ${report.score}% clean across ${report.total} products.`, status: "success" });

    return { report };
  });
}
