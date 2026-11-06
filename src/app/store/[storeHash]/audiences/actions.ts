"use server";

import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { addCustomersToSegment, createSegment } from "@/lib/audiences/segments-api";
import { SEGMENT_ID } from "@/lib/audiences/segment-types";
import { cleanText } from "@/lib/copilot/guard";
import { AppError } from "@/lib/errors/app-error";
import { logAudit, logError } from "@/lib/errors/logger";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();
const createSchema = z.object({
  name: z.string().trim().min(1, "Give the segment a name").max(100, "Keep the name under 100 characters"),
  description: z.string().trim().max(255, "Keep the description under 255 characters").default(""),
});
const membersSchema = z.object({
  segmentId: z.string().regex(SEGMENT_ID),
  emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(50),
});

export interface SegmentActionResult extends ActionResult {
  segmentId?: string;
}

function failure(error: unknown, context: string): ActionResult {
  logError(context, error);

  return { success: false, message: error instanceof AppError ? error.message : "BigCommerce didn't accept that. Nothing was changed." };
}

// Creates an empty customer segment through the Segmentation API.
export async function createCustomerSegment(storeHash: unknown, input: unknown): Promise<SegmentActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);
  const parsed = createSchema.safeParse(input);

  if (!hash.success) return { success: false, message: "Invalid request." };
  if (!parsed.success) return { success: false, message: parsed.error.issues[0]?.message ?? "That segment isn't valid." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  try {
    const segment = await createSegment(hash.data, { name: cleanText(parsed.data.name, 100), description: cleanText(parsed.data.description, 255) });

    logAudit("segment.create", { storeHash: hash.data, segmentId: segment.id });

    return { success: true, message: `Segment "${segment.name}" created.`, segmentId: segment.id };
  } catch (error) {
    return failure(error, "createCustomerSegment");
  }
}

// Adds registered customers, identified by email, to an existing segment.
export async function addCustomersToCustomerSegment(storeHash: unknown, segmentId: unknown, emails: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);
  const parsed = membersSchema.safeParse({ segmentId, emails });

  if (!hash.success) return { success: false, message: "Invalid request." };
  if (!parsed.success) return { success: false, message: "Enter between 1 and 50 valid email addresses." };
  if (!(await isAuthorizedForStore(hash.data))) return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };

  try {
    const result = await addCustomersToSegment(hash.data, parsed.data.segmentId, [...new Set(parsed.data.emails)]);

    logAudit("segment.add_customers", { storeHash: hash.data, segmentId: parsed.data.segmentId, added: result.added });

    const parts = [`Added ${result.added} customer${result.added === 1 ? "" : "s"}.`];

    if (result.alreadyMembers > 0) parts.push(`${result.alreadyMembers} already in the segment.`);
    if (result.notFound.length > 0) parts.push(`No registered customer for: ${result.notFound.slice(0, 5).join(", ")}${result.notFound.length > 5 ? "…" : ""}.`);

    return { success: result.added > 0 || result.alreadyMembers > 0, message: parts.join(" ") };
  } catch (error) {
    return failure(error, "addCustomersToCustomerSegment");
  }
}
