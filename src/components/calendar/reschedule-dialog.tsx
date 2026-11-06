"use client";

import { Modal } from "@bigcommerce/big-design";
import { formatDay } from "@/lib/promo-calendar/dates";
import type { CalendarPromotion, Conflict } from "@/lib/promo-calendar/types";

export interface PendingReschedule {
  promotion: CalendarPromotion;
  nextStart: Date | null;
  nextEnd: Date | null;
  newConflicts: Conflict[];
  startsImmediately: boolean;
  endsImmediately: boolean;
}

function DateLine({ label, before, after, timeZone }: { label: string; before: Date | null; after: Date | null; timeZone: string }) {
  const changed = (before?.getTime() ?? null) !== (after?.getTime() ?? null);

  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--pp-border)", fontSize: 14 }}>
      <div style={{ width: 60, color: "var(--pp-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--pp-muted)", textDecoration: changed ? "line-through" : "none" }}>{before ? formatDay(before, timeZone) : "None"}</div>
      {changed && <div style={{ fontWeight: 700 }}>→ {after ? formatDay(after, timeZone) : "None"}</div>}
    </div>
  );
}

export function RescheduleDialog({ pending, saving, timeZone, onConfirm, onCancel }: { pending: PendingReschedule | undefined; saving: boolean; timeZone: string; onConfirm(): void; onCancel(): void }) {
  if (!pending) return null;

  const { promotion } = pending;

  return (
    <Modal
      isOpen
      onClose={onCancel}
      closeOnClickOutside={false}
      header={`Reschedule "${promotion.displayName}"?`}
      actions={[
        { text: "Cancel", variant: "subtle", onClick: onCancel, disabled: saving },
        { text: "Confirm and save", onClick: onConfirm, isLoading: saving },
      ]}
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>This updates the promotion in your BigCommerce store. Nothing else about it changes. Dates are in your store&apos;s time zone ({timeZone}).</p>
      <DateLine label="Starts" before={promotion.start} after={pending.nextStart} timeZone={timeZone} />
      <DateLine label="Ends" before={promotion.end} after={pending.nextEnd} timeZone={timeZone} />
      {pending.startsImmediately && (
        <p style={{ fontSize: 13, color: "var(--pp-exhausted)" }}>The new start is in the past, so this promotion will apply to shoppers straight away.</p>
      )}
      {pending.endsImmediately && (
        <p style={{ fontSize: 13, color: "var(--pp-exhausted)" }}>The new end is in the past, so this promotion will stop applying straight away.</p>
      )}
      {pending.newConflicts.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <strong style={{ color: "var(--pp-invalid)" }}>New overlaps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {pending.newConflicts.map((conflict) => (
              <li key={conflict.promotionIds.join("-")}>{conflict.message}</li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
