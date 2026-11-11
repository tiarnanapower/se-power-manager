"use client";

import { useRef, useState } from "react";
import { restoreBatchAction } from "@/app/store/[storeHash]/catalog/personal/actions";
import { Modal } from "@/components/samples/modal";
import type { PackSummary } from "@/lib/app-data/types";
import { SAMPLE_SECTIONS } from "@/lib/samples/format";

type Phase = "choose" | "running" | "done";

// Restores a saved pack. Personal packs hold the catalog; the other sections are listed so it's clear
// what a personal pack doesn't contain yet.
export function RestorePackDialog({ storeHash, pack, imageStorage, onClose }: { storeHash: string | undefined; pack: PackSummary; imageStorage: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [progress, setProgress] = useState({ done: 0, total: pack.productCount });
  const [totals, setTotals] = useState({ created: 0, skipped: 0, failed: 0, imagesMissing: 0 });
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const cancel = useRef(false);

  const run = async () => {
    cancel.current = false;
    setPhase("running");
    setError(undefined);

    const sum = { created: 0, skipped: 0, failed: 0, imagesMissing: 0 };
    const notes: string[] = [];

    try {
      for (let offset = 0; ;) {
        if (cancel.current) {
          setError("Stopped. Products already created stay in your store.");
          break;
        }

        const result = await restoreBatchAction(storeHash, { packId: pack.id, offset });

        if (!result.ok) {
          setError(result.message);
          break;
        }

        const { batch } = result;

        sum.created += batch.created;
        sum.skipped += batch.skipped;
        sum.failed += batch.failed;
        sum.imagesMissing += batch.imagesMissing;
        notes.push(...batch.errors.map((entry) => `${entry.name}: ${entry.reason}`), ...batch.differences.map((entry) => `${entry.name}: ${entry.detail}`));
        setTotals({ ...sum });
        setIssues(notes.slice(0, 60));
        setProgress({ done: batch.nextOffset, total: batch.total });

        if (batch.done || batch.nextOffset <= offset) break;

        offset = batch.nextOffset;
      }
    } catch {
      setError("Lost contact with the server. Products already created stay in your store.");
    } finally {
      setPhase("done");
    }
  };

  return (
    <Modal
      title="Restore sections"
      onClose={phase === "running" ? () => undefined : onClose}
      footer={
        phase === "choose" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={run}>Restore 1 section</button>
          </>
        ) : phase === "running" ? (
          <button type="button" className="pp-btn" onClick={() => { cancel.current = true; }}>Stop after this batch</button>
        ) : (
          <button type="button" className="pp-btn pp-btn--primary" onClick={onClose}>Close</button>
        )
      }
    >
      <p className="pp-section__hint">Bring <strong>{pack.name}</strong> back into your store. Products whose SKU already exists are skipped, categories and brands are matched by name, and nothing is deleted.</p>

      {phase === "choose" && (
        <>
          <ul className="pp-sections">
            {SAMPLE_SECTIONS.map((section) => (
              <li key={section.id} className={section.id === "catalog" ? "" : "is-off"}>
                <label>
                  <input type="checkbox" checked={section.id === "catalog"} disabled readOnly />
                  <span>
                    <strong>{section.label}</strong>
                    <span className="pp-muted">{section.description}</span>
                    {section.id !== "catalog" && <em>Not saved in personal catalogs yet</em>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {pack.imagesState === "skipped" && <div className="pp-warn" style={{ marginTop: 14 }}>{imageStorage ? "This pack only links to the pictures of the store it was saved from, and those were removed with the products, so they'll be left out." : "This pack only links to its pictures, which BigCommerce deletes with the products, so they'll be left out."}</div>}
        </>
      )}

      {phase !== "choose" && (
        <div>
          <strong>{phase === "running" ? "Restoring the catalog" : "Finished"}</strong>
          <div className={`pp-progress${phase === "running" ? " is-active" : ""}`}><span style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} /></div>
          <div className="pp-muted" style={{ fontSize: 13 }}>{progress.done} of {progress.total} products · {totals.created} created · {totals.skipped} skipped · {totals.failed} failed{totals.imagesMissing ? ` · ${totals.imagesMissing} images missing` : ""}</div>
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
          {phase === "done" && !error && <div role="status" className={`pp-msg ${totals.failed ? "pp-msg--err" : "pp-msg--ok"}`}>Done. {totals.created} created, {totals.skipped} skipped, {totals.failed} failed.</div>}
          {issues.length > 0 && <ul className="pp-errlist">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}
