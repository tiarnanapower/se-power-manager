"use client";

import { useState } from "react";
import { Modal } from "@/components/samples/modal";
import { isSlug, SAMPLE_SECTIONS, slugify, type SampleSectionId } from "@/lib/samples/format";
import { buildStoreSnapshot, downloadBytes } from "@/lib/samples/snapshot-client";

type Phase = "form" | "running" | "done";

// Reads the connected store and downloads it as a zip in the Store Templates format: products with
// variants, options, custom fields and pictures, plus the settings sections that can be saved.
export function DownloadSnapshotDialog({ storeHash, onClose }: { storeHash: string | undefined; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<Set<SampleSectionId>>(new Set(["catalog"]));
  const [stage, setStage] = useState("");
  const [fraction, setFraction] = useState(0);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ file: string; version: string; products: number; images: number; warnings: string[] }>();

  const valid = name.trim().length > 0 && isSlug(slug);
  const toggle = (id: SampleSectionId) => setSections((current) => {
    const next = new Set(current);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    return next;
  });

  const run = async () => {
    setPhase("running");
    setError(undefined);
    setFraction(0);

    try {
      const snapshot = await buildStoreSnapshot(storeHash, {
        name: name.trim(),
        slug,
        description: description.trim(),
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        notes: notes.trim(),
        sections: [...sections],
        onProgress: (next, amount) => {
          setStage(next);
          setFraction(amount);
        },
      });

      downloadBytes(snapshot.file, snapshot.bytes);
      setResult({ file: snapshot.file, version: snapshot.version, products: snapshot.counts.products, images: snapshot.counts.images, warnings: snapshot.warnings });
      setPhase("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The snapshot failed.");
      setPhase("form");
    }
  };

  return (
    <Modal
      title="Download a snapshot"
      wide
      onClose={phase === "running" ? () => undefined : onClose}
      footer={
        phase === "form" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={run} disabled={!valid}>Download zip</button>
          </>
        ) : phase === "running" ? null : (
          <button type="button" className="pp-btn pp-btn--primary" onClick={onClose}>Close</button>
        )
      }
    >
      {phase === "form" && (
        <div>
          <p className="pp-section__hint">Saves your store as a zip file in the same format as Store Templates. Nothing is stored on a server: you keep the file, and can upload it here later to load it into this or another store.</p>
          <label className="pp-field"><span>Snapshot name</span><input className="pp-input" value={name} onChange={(event) => { setName(event.target.value); if (!slugEdited) setSlug(slugify(event.target.value)); }} maxLength={120} placeholder="Outdoor retailer, November" /></label>
          <label className="pp-field"><span>File name</span><input className="pp-input" value={slug} onChange={(event) => { setSlug(event.target.value.toLowerCase()); setSlugEdited(true); }} maxLength={64} aria-invalid={slug !== "" && !isSlug(slug)} /><small className="pp-muted">Lower-case letters, numbers and dashes. Use the name of an existing template to number this as its next version.</small></label>
          <label className="pp-field"><span>Description</span><input className="pp-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
          <label className="pp-field"><span>Tags</span><input className="pp-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="uk, outdoor" /></label>
          <label className="pp-field"><span>What is in this version</span><input className="pp-input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} /></label>

          <p className="pp-section__hint" style={{ marginTop: 18 }}>What to include</p>
          <ul className="pp-sections">
            {SAMPLE_SECTIONS.map((section) => (
              <li key={section.id} className={section.implemented ? "" : "is-off"}>
                <label>
                  <input type="checkbox" checked={sections.has(section.id) && section.implemented} disabled={!section.implemented || section.id === "catalog"} onChange={() => toggle(section.id)} />
                  <span>
                    <strong>{section.label}</strong>
                    <span className="pp-muted">{section.description}</span>
                    {!section.implemented && <em>Saving this isn&apos;t available yet</em>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
        </div>
      )}

      {phase === "running" && (
        <div>
          <strong>{stage}</strong>
          <div className="pp-progress is-active"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
        </div>
      )}

      {phase === "done" && result && (
        <div>
          <div role="status" className="pp-msg pp-msg--ok">Downloaded {result.file}: {result.products} products and {result.images} pictures as {result.version}.</div>
          <p className="pp-section__hint">Keep the file somewhere safe. To use it again, upload it under My Snapshots. To share it with everyone, unzip it into the templates repo, then commit and push.</p>
          {result.warnings.length > 0 && (
            <>
              <p className="pp-section__hint">Worth a look:</p>
              <ul className="pp-errlist">{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
