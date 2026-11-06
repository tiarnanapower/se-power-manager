"use client";

import type { DraftPreview } from "@/lib/copilot/draft-spec";

export type DraftStatus = "pending" | "applying" | "applied" | "discarded" | "failed";

export interface DraftView {
  id: string;
  preview: DraftPreview;
  isCreate: boolean;
  status: DraftStatus;
  // Result text after applying, or the failure reason.
  note?: string;
  promotionId?: number;
  enabled?: boolean;
  // Signed by the server with the proposal; Apply and Enable send them back.
  token?: string;
  enableToken?: string;
}

interface Props {
  draft: DraftView;
  busy: boolean;
  onApply(): void;
  onDiscard(): void;
  onEnable(): void;
}

// A proposed change, shown for review. Nothing is written until Apply is pressed.
export function DraftCard({ draft, busy, onApply, onDiscard, onEnable }: Props) {
  const { preview, status } = draft;
  const settled = status === "applied" || status === "discarded";

  return (
    <div className="pp-card" style={{ boxShadow: "none", marginTop: 8, opacity: status === "discarded" ? 0.6 : 1 }} role="group" aria-label={`Draft: ${preview.title}`}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--pp-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13, flex: 1 }}>{preview.title}</strong>
        <span className={`pp-pill pp-pill--${status === "applied" ? "live" : status === "failed" ? "invalid" : status === "discarded" ? "ended" : "scheduled"}`}>
          {status === "pending" ? "Draft" : status === "applying" ? "Saving…" : status === "applied" ? "Applied" : status === "discarded" ? "Discarded" : "Failed"}
        </span>
      </div>
      <dl style={{ margin: 0, padding: "4px 12px" }}>
        {preview.lines.filter((line, i, all) => !(/^display name$/i.test(line.label) && all.some((other) => /^name$/i.test(other.label) && other.after === line.after))).map((line) => (
          <div key={line.label} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 8, padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--pp-bg)" }}>
            <dt className="pp-muted" style={{ fontWeight: 600 }}>{line.label}</dt>
            <dd style={{ margin: 0 }}>
              {line.before && line.before !== line.after && <span className="pp-muted" style={{ textDecoration: "line-through", marginRight: 6 }}>{line.before}</span>}
              {line.after}
            </dd>
          </div>
        ))}
      </dl>
      {preview.warnings.length > 0 && (
        <ul style={{ margin: 0, padding: "8px 12px 8px 28px", fontSize: 12, color: "var(--pp-exhausted)", background: "var(--pp-exhausted-bg)" }}>
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {draft.note && (
        <div role="status" style={{ padding: "8px 12px", fontSize: 12, color: status === "failed" ? "var(--pp-invalid)" : "var(--pp-muted)" }}>{draft.note}</div>
      )}
      {!settled && (
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--pp-border)" }}>
          <button type="button" className="pp-btn pp-btn--primary" onClick={onApply} disabled={busy || status === "applying"}>
            {status === "failed" ? "Try again" : draft.isCreate ? "Create (disabled)" : "Apply change"}
          </button>
          <button type="button" className="pp-btn" onClick={onDiscard} disabled={busy || status === "applying"}>Discard</button>
        </div>
      )}
      {status === "applied" && draft.isCreate && draft.promotionId !== undefined && !draft.enabled && (
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--pp-border)" }}>
          <button type="button" className="pp-btn" onClick={onEnable} disabled={busy}>Enable now</button>
          <span className="pp-muted" style={{ fontSize: 12, alignSelf: "center" }}>Makes it live for shoppers.</span>
        </div>
      )}
    </div>
  );
}
