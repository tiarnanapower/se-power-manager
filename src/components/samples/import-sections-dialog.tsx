"use client";

import { useRef, useState } from "react";
import { finishSamplePickListsAction, importSampleBatchAction, importSampleSectionAction } from "@/app/store/[storeHash]/catalog/samples/actions";
import { Modal } from "@/components/samples/modal";
import { SAMPLE_SECTIONS, sectionLabel, type SampleManifest, type SampleSectionId } from "@/lib/samples/format";

interface Props {
  storeHash: string | undefined;
  // How many products the catalog has, so the bar can show before the first batch returns.
  productCount: number;
  slug: string;
  name: string;
  version: string;
  manifest: SampleManifest;
  languages: string[];
  defaultLanguage: string;
  onClose: () => void;
}

type Phase = "choose" | "running" | "done";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", fr: "French", es: "Spanish", it: "Italian", de: "German", pt: "Portuguese", nl: "Dutch", ja: "Japanese" };
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

export function ImportSectionsDialog({ storeHash, productCount, slug, name, version, manifest, languages, defaultLanguage, onClose }: Props) {
  const [selected, setSelected] = useState<Set<SampleSectionId>>(new Set(SAMPLE_SECTIONS.filter((section) => section.defaultChecked).map((section) => section.id)));
  const [language, setLanguage] = useState(defaultLanguage);
  const [phase, setPhase] = useState<Phase>("choose");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState({ created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0 });
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const cancel = useRef(false);

  const available = (id: SampleSectionId) => Boolean(manifest.sections[id]);
  const importable = (id: SampleSectionId) => available(id) && SAMPLE_SECTIONS.find((section) => section.id === id)?.implemented === true;
  const toggle = (id: SampleSectionId) => setSelected((current) => {
    const next = new Set(current);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    return next;
  });

  const run = async () => {
    cancel.current = false;
    setPhase("running");
    setError(undefined);
    setIssues([]);

    const sum = { created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0 };
    const notes: string[] = [];

    setTotals({ ...sum });
    setProgress({ done: 0, total: productCount });

    try {
      if (selected.has("catalog")) {
        setStage("Importing the catalog");

        for (let offset = 0; ;) {
          if (cancel.current) {
            setError("Stopped. Products already created stay in your store.");
            break;
          }

          const result = await importSampleBatchAction(storeHash, { slug, version, offset });

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

        // Pick lists point at other products, so they wait until every product exists.
        if (!cancel.current) {
          setStage("Linking pick lists");

          for (let offset = 0; ;) {
            const result = await finishSamplePickListsAction(storeHash, { slug, version, offset });

            if (!result.ok) {
              notes.push(`Pick lists: ${result.message}`);
              break;
            }

            sum.pickLists += result.created;
            notes.push(...result.warnings.map((entry) => `${entry.name}: ${entry.detail}`));
            setTotals({ ...sum });
            setIssues(notes.slice(0, 60));

            if (result.done || result.nextOffset <= offset) break;

            offset = result.nextOffset;
          }
        }
      }

      // The other sections are small settings, imported one request each after the catalog.
      for (const id of SAMPLE_SECTIONS.map((section) => section.id)) {
        if (id === "catalog" || !selected.has(id) || !importable(id) || cancel.current) continue;

        setStage(`Importing ${sectionLabel(id)}`);

        const done = await importSampleSectionAction(storeHash, { slug, version, section: id });

        if (!done.ok) {
          notes.push(`${sectionLabel(id)}: ${done.message}`);
        } else {
          notes.push(`${sectionLabel(id)}: ${done.result.created} created, ${done.result.updated} updated, ${done.result.skipped} skipped`, ...done.result.warnings.map((warning) => `${warning}`));
        }

        setIssues(notes.slice(0, 60));
      }
    } catch {
      setError("Lost contact with the server. Products already created stay in your store.");
    } finally {
      setPhase("done");
    }
  };

  const chosen = [...selected].filter(importable);

  return (
    <Modal
      title="Import sections"
      onClose={phase === "running" ? () => undefined : onClose}
      footer={
        phase === "choose" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={run} disabled={chosen.length === 0}>Import {chosen.length} section{chosen.length === 1 ? "" : "s"}</button>
          </>
        ) : phase === "running" ? (
          <button type="button" className="pp-btn" onClick={() => { cancel.current = true; }}>Stop after this batch</button>
        ) : (
          <button type="button" className="pp-btn pp-btn--primary" onClick={onClose}>Close</button>
        )
      }
    >
      <p className="pp-section__hint">Choose what to bring into your store from <strong>{name}</strong> ({version}). Existing products with the same SKU are skipped, and nothing is deleted.</p>

      {phase === "choose" && (
        <>
          <ul className="pp-sections">
            {SAMPLE_SECTIONS.map((section) => {
              const present = available(section.id);
              const ready = importable(section.id);

              return (
                <li key={section.id} className={ready ? "" : "is-off"}>
                  <label>
                    <input type="checkbox" checked={selected.has(section.id) && ready} disabled={!ready} onChange={() => toggle(section.id)} />
                    <span>
                      <strong>{section.label}</strong>
                      <span className="pp-muted">{section.description}</span>
                      {!present && <em>Not in this sample</em>}
                      {present && !ready && <em>Importer coming soon</em>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {languages.length > 1 && (
            <label className="pp-field" style={{ marginTop: 16 }}>Default language for the store
              <select className="pp-input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {languages.map((code) => <option key={code} value={code}>{languageName(code)}{code === defaultLanguage ? " (sample default)" : ""}</option>)}
              </select>
              <span className="pp-muted" style={{ fontWeight: 400 }}>Applied when the Localization section is imported. It isn&apos;t available yet.</span>
            </label>
          )}
        </>
      )}

      {phase !== "choose" && (
        <div>
          <strong>{phase === "running" ? stage : "Finished"}</strong>
          {(progress.total > 0 || phase === "running") && (
            <>
              <div className={`pp-progress${phase === "running" ? " is-active" : ""}`}><span style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} /></div>
              <div className="pp-muted" style={{ fontSize: 13 }}>{progress.done} of {progress.total} products · {totals.created} created · {totals.skipped} skipped · {totals.failed} failed{totals.imagesMissing ? ` · ${totals.imagesMissing} images missing` : ""}{totals.pickLists ? ` · ${totals.pickLists} pick lists linked` : ""}</div>
            </>
          )}
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
          {phase === "done" && !error && <div role="status" className={`pp-msg ${totals.failed ? "pp-msg--err" : "pp-msg--ok"}`}>Done. {totals.created} created, {totals.skipped} skipped, {totals.failed} failed.</div>}
          {issues.length > 0 && <ul className="pp-errlist">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}
