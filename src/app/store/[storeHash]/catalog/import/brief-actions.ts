"use server";

import { z } from "zod";
import { type Outcome, runLocalAction, runStoreAction } from "@/lib/actions/run-action";
import { buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/generate";
import { readAll, text } from "@/lib/samples/sections/shared";

const group = z.string().trim().min(1).max(100);

export async function generateBriefAction(storeHash: unknown, input: unknown): Promise<Outcome<{ brief: Brief }>> {
  const parsed = z.object({
    url: z.string().trim().max(2000).url(),
    audiences: z.array(z.enum(["b2c", "b2b"])).min(1).max(2),
    groups: z.object({ b2c: z.array(group).max(30).optional(), b2b: z.array(group).max(30).optional() }),
  }).safeParse(input);

  if (!parsed.success) return { ok: false, message: "Enter a full web address, starting with https://, and choose at least one audience." };

  return runLocalAction(storeHash, "generateBriefAction", async () => ({ brief: await buildBrief(parsed.data.url, [...new Set(parsed.data.audiences)], parsed.data.groups) }));
}

// The store's customer groups, so the slots can name who they are for.
export async function customerGroupsAction(storeHash: unknown): Promise<Outcome<{ groups: string[] }>> {
  return runStoreAction(storeHash, "customerGroupsAction", async (ctx) => ({ groups: (await readAll(ctx.client, "/v2/customer_groups")).map((row) => text(row.name)).filter(Boolean) }));
}
