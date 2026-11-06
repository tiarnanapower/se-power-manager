"use server";

import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { fetchPromotion, updatePromotion } from "@/lib/promotions/promotions-api";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

const storeHashSchema = z.string().regex(/^[a-z0-9]{3,20}$/i).optional();
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

const rescheduleSchema = z.object({
  id: z.number().int().positive(),
  // What the client believed the dates were: guards against overwriting a
  // change someone made in the control panel since the page loaded.
  expectedStart: isoDate.nullable(),
  expectedEnd: isoDate.nullable(),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
});

// BigCommerce examples use RFC 3339 with an explicit offset, so send that form.
function toBcDate(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function sameInstant(a: string | null | undefined, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return new Date(a).getTime() === new Date(b).getTime();
}

// Moves or resizes a promotion's schedule. Only called after the user confirms
// the before/after dialog; changes dates and nothing else.
export async function reschedulePromotion(storeHash: unknown, input: unknown): Promise<ActionResult> {
  const hash = storeHashSchema.safeParse(storeHash);
  const parsed = rescheduleSchema.safeParse(input);

  if (!hash.success || !parsed.success) {
    return { success: false, message: "That change wasn't valid. Reload the page and try again." };
  }

  if (!(await isAuthorizedForStore(hash.data))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const { id, expectedStart, expectedEnd, start, end } = parsed.data;

  if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
    return { success: false, message: "The end date must be after the start date." };
  }

  try {
    const current = await fetchPromotion(id, hash.data);

    if (!sameInstant(current.start_date, expectedStart) || !sameInstant(current.end_date, expectedEnd)) {
      return { success: false, message: "This promotion changed since you loaded the page. Reload and try again." };
    }

    await updatePromotion(id, { ...current, start_date: toBcDate(start), end_date: toBcDate(end) }, hash.data);

    return { success: true, message: `"${current.display_name || current.name}" rescheduled.` };
  } catch (error) {
    logError("reschedulePromotion", error);

    return {
      success: false,
      message: error instanceof AppError ? error.message : "BigCommerce didn't accept the change. Nothing was saved.",
    };
  }
}
