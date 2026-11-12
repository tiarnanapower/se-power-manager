"use client";

import { useState } from "react";
import type { ImportSource } from "@/components/samples/import-source";
import { JobProgress } from "@/components/jobs/job-progress";
import { Modal } from "@/components/samples/modal";
import { dismissJob, finishJob, isCancelled, patchJob, requestCancel, startJob, useJob, type Job } from "@/lib/jobs/job-store";
import { SAMPLE_SECTIONS, sectionLabel, type SampleSectionId } from "@/lib/samples/format";

interface Props {
  source: ImportSource;
  onClose: () => void;
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", fr: "French", es: "Spanish", it: "Italian", de: "German", pt: "Portuguese", nl: "Dutch", ja: "Japanese" };
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

export function ImportSectionsDialog({ source, onClose }: Props) {
  const { productCount, name, version, manifest, languages, defaultLanguage } = source;
  const [selected, setSelected] = useState<Set<SampleSectionId>>(new Set(SAMPLE_SECTIONS.filter((section) => section.defaultChecked).map((section) => section.id)));
  const [language, setLanguage] = useState(defaultLanguage);
  // The run lives in the job store, so closing this popup or leaving the page doesn't lose its progress.
  const jobId = `import:${name}:${version}`;
  const job = useJob(jobId);
  const phase = job?.phase ?? "choose";

  const available = (id: SampleSectionId) => Boolean(manifest.sections[id]);
  const importable = (id: SampleSectionId) => available(id) && SAMPLE_SECTIONS.find((section) => section.id === id)?.implemented === true;
  const toggle = (id: SampleSectionId) => setSelected((current) => {
    const next = new Set(current);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    return next;
  });

  const run = async () => {
    startJob(jobId, { title: `Import: ${name}`, href: window.location.pathname, stage: "Starting", total: productCount });

    const sum = { created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0 };
    const notes: string[] = [];
    const summary = () => `${sum.created} created · ${sum.skipped} skipped · ${sum.failed} failed${sum.imagesMissing ? ` · ${sum.imagesMissing} images missing` : ""}${sum.pickLists ? ` · ${sum.pickLists} pick lists linked` : ""}`;
    const show = (more: Partial<Job> = {}) => patchJob(jobId, { summary: summary(), issues: notes.slice(0, 60), ...more });
    let error: string | undefined;

    try {
      if (selected.has("catalog")) {
        show({ stage: "Importing the catalog" });

        for (let offset = 0; ;) {
          if (isCancelled(jobId)) {
            error = "Stopped. Products already created stay in your store.";
            break;
          }

          const result = await source.importBatch(offset);

          if (!result.ok) {
            error = result.message;
            break;
          }

          const { batch } = result;

          sum.created += batch.created;
          sum.skipped += batch.skipped;
          sum.failed += batch.failed;
          sum.imagesMissing += batch.imagesMissing;
          notes.push(...batch.errors.map((entry) => `${entry.name}: ${entry.reason}`), ...batch.differences.map((entry) => `${entry.name}: ${entry.detail}`));
          show({ done: batch.nextOffset, total: batch.total });

          if (batch.done || batch.nextOffset <= offset) break;

          offset = batch.nextOffset;
        }

        // Pick lists point at other products, so they wait until every product exists.
        if (!error) {
          show({ stage: "Linking pick lists" });

          for (let offset = 0; ;) {
            const result = await source.finishPickLists(offset);

            if (!result.ok) {
              notes.push(`Pick lists: ${result.message}`);
              break;
            }

            sum.pickLists += result.created;
            notes.push(...result.warnings.map((entry) => `${entry.name}: ${entry.detail}`));
            show();

            if (result.done || result.nextOffset <= offset) break;

            offset = result.nextOffset;
          }
        }
      }

      // The other sections are small settings, imported one request each after the catalog.
      for (const id of SAMPLE_SECTIONS.map((section) => section.id)) {
        if (id === "catalog" || !selected.has(id) || !importable(id) || error || isCancelled(jobId)) continue;

        show({ stage: `Importing ${sectionLabel(id)}` });

        const done = await source.importSection(id, { defaultLanguage: language });

        if (!done.ok) {
          notes.push(`${sectionLabel(id)}: ${done.message}`);
        } else {
          notes.push(`${sectionLabel(id)}: ${done.result.created} created, ${done.result.updated} updated, ${done.result.skipped} skipped`, ...done.result.warnings.map((warning) => `${warning}`));
        }

        show();
      }
    } catch {
      error = "Lost contact with the server. Products already created stay in your store.";
    } finally {
      finishJob(jobId, { summary: summary(), issues: notes.slice(0, 60), error });
    }
  };

  const chosen = [...selected].filter(importable);

  return (
    <Modal
      title="Import sections"
      onClose={onClose}
      footer={
        phase === "choose" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={run} disabled={chosen.length === 0}>Import {chosen.length} section{chosen.length === 1 ? "" : "s"}</button>
          </>
        ) : phase === "running" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Hide (keeps running)</button>
            <button type="button" className="pp-btn" disabled={job?.cancelRequested} onClick={() => requestCancel(jobId)}>{job?.cancelRequested ? "Stopping…" : "Stop after this batch"}</button>
          </>
        ) : (
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => { dismissJob(jobId); onClose(); }}>Close</button>
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
              <span className="pp-muted" style={{ fontWeight: 400 }}>Applied when the Localization section is imported.</span>
            </label>
          )}
        </>
      )}

      {job && (
        <div>
          <strong>{job.phase === "running" ? job.stage : "Finished"}</strong>
          <JobProgress job={job} unit="products" />
          {job.phase === "running" && <p className="pp-muted" style={{ fontSize: 13 }}>You can hide this and use other pages: the import keeps going while this tab stays open, and its progress shows in the corner.</p>}
          {job.error && <div role="status" className="pp-msg pp-msg--err">{job.error}</div>}
          {job.phase === "done" && !job.error && <div role="status" className="pp-msg pp-msg--ok">Done.</div>}
          {job.issues.length > 0 && <ul className="pp-errlist">{job.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}
