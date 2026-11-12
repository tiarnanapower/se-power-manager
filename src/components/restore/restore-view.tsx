"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearBatchAction, deletePackAction, previewClearAction, startClearAction } from "@/app/store/[storeHash]/catalog/personal/actions";
import { DownloadSnapshotDialog } from "@/components/personal/download-snapshot-dialog";
import { UploadSnapshot } from "@/components/personal/upload-snapshot";
import { PackCard, PackGrid } from "@/components/packs/pack-card";
import { Modal } from "@/components/samples/modal";
import { SAMPLE_SECTIONS } from "@/lib/samples/format";
import type { PackSummary } from "@/lib/app-data/types";
import { getAppUrl } from "@/lib/routing/app-url";
import { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION } from "@/lib/catalog/constants";
import { buildStoreSnapshot, downloadBytes } from "@/lib/samples/snapshot-client";

interface Props {
  storeHash: string | undefined;
  // Catalogs saved on the server before snapshots became downloads. They can still be opened and downloaded.
  packs: PackSummary[];
  canWrite: boolean;
}

type Message = { ok: boolean; text: string } | undefined;

function Section({ title, hint, danger, children }: { title: string; hint: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <section className={`pp-card pp-section${danger ? " pp-danger-zone" : ""}`}>
      <h2>{title}</h2>
      <p className="pp-section__hint">{hint}</p>
      {children}
    </section>
  );
}

function Msg({ message }: { message: Message }) {
  return message ? <div role="status" className={`pp-msg ${message.ok ? "pp-msg--ok" : "pp-msg--err"}`}>{message.text}</div> : null;
}

function Progress({ done, total }: { done: number; total: number }) {
  return <div className="pp-progress" aria-hidden="true"><span style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></div>;
}

function DownloadSection({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Section title="Download a snapshot" hint="Saves your store as a zip file: products with variants, options, custom fields and pictures, plus settings such as shipping and tax. You keep the file, and nothing is stored on a server.">
      <button type="button" className="pp-btn pp-btn--primary" onClick={() => setOpen(true)} disabled={!canWrite}>Download a snapshot…</button>
      {open && <DownloadSnapshotDialog storeHash={storeHash} onClose={() => setOpen(false)} />}
    </Section>
  );
}

type Backup = { file: string; ids: number[] };

// Clearing always starts with a download: the snapshot of exactly what is about to be deleted.
function ClearBody({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const router = useRouter();
  const [scope, setScope] = useState<"demo" | "all">("demo");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | undefined>();
  const [confirmation, setConfirmation] = useState("");
  const [backup, setBackup] = useState<Backup>();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<Message>();

  const reset = (next: "demo" | "all") => {
    setScope(next);
    setPreview(undefined);
    setConfirmation("");
    setBackup(undefined);
    setMessage(undefined);
  };

  const runPreview = async () => {
    setBusy(true);
    setMessage(undefined);

    try {
      const result = await previewClearAction(storeHash, { scope });

      if (result.ok) setPreview(result.preview);
      else setMessage({ ok: false, text: result.message });
    } catch {
      setMessage({ ok: false, text: "Couldn't count products. Try again." });
    } finally {
      setBusy(false);
    }
  };

  // Step 1: download a snapshot of what would be deleted. Nothing is deleted yet.
  const downloadBackup = async () => {
    setBusy(true);
    setMessage(undefined);

    try {
      const started = await startClearAction(storeHash, { scope, confirmation });

      if (!started.ok) return setMessage({ ok: false, text: started.message });
      if (started.start.ids.length === 0) return setMessage({ ok: true, text: "Nothing to clear." });

      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const snapshot = await buildStoreSnapshot(storeHash, {
        name: `Backup before clearing (${scope === "all" ? "whole catalog" : "app-created products"})`,
        slug: `backup-${stamp}`,
        notes: "Saved before a bulk clear.",
        sections: [],
        ids: started.start.ids,
        onProgress: (stage, fraction) => {
          setPhase(stage);
          setProgress({ done: Math.round(fraction * 100), total: 100 });
        },
      });

      downloadBytes(snapshot.file, snapshot.bytes);
      setBackup({ file: snapshot.file, ids: started.start.ids });
      setMessage({ ok: true, text: `Downloaded ${snapshot.file} with ${snapshot.counts.products} products and ${snapshot.counts.images} pictures. Check it saved, then delete.` });
    } catch (failure) {
      setMessage({ ok: false, text: `Nothing was deleted. The backup couldn't be made: ${failure instanceof Error ? failure.message : "unknown error"}` });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  // Step 2: delete, once the backup has been downloaded.
  const clear = async () => {
    if (!backup) return;

    setBusy(true);
    setMessage(undefined);
    setPhase("Deleting…");

    let deleted = 0;

    try {
      setProgress({ done: 0, total: backup.ids.length });

      for (let start = 0; start < backup.ids.length; start += CLEAR_BATCH_SIZE) {
        const result = await clearBatchAction(storeHash, { scope, ids: backup.ids.slice(start, start + CLEAR_BATCH_SIZE) });

        if (!result.ok) return setMessage({ ok: false, text: `${result.message} ${deleted} deleted before it stopped. Your backup is ${backup.file}.` });

        deleted += result.batch.deleted;
        setProgress({ done: deleted, total: backup.ids.length });
      }

      setMessage({ ok: true, text: `Cleared ${deleted} products. To undo, upload ${backup.file} above.` });
      setPreview(undefined);
      setConfirmation("");
      setBackup(undefined);
    } catch {
      setMessage({ ok: false, text: "Lost contact with the server. Check the Activity page for what completed." });
    } finally {
      setBusy(false);
      setPhase("");
      router.refresh();
    }
  };

  const armed = Boolean(preview && preview.count > 0 && confirmation === CLEAR_CONFIRMATION);

  return (
    <>
      <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }} disabled={busy}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}><input type="radio" name="scope" checked={scope === "demo"} onChange={() => reset("demo")} /> Only products this app created</label>
        <label style={{ display: "block", fontSize: 14 }}><input type="radio" name="scope" checked={scope === "all"} onChange={() => reset("all")} /> The whole catalog</label>
      </fieldset>
      <button type="button" className="pp-btn" onClick={runPreview} disabled={busy || !canWrite}>Count what would be deleted</button>
      {preview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14 }}><strong>{preview.count}</strong> product{preview.count === 1 ? "" : "s"} would be deleted{preview.sample.length ? `, including ${preview.sample.join(", ")}` : ""}.</div>
          {preview.count > 0 && (
            <div style={{ marginTop: 12 }}>
              <label className="pp-field">Type {CLEAR_CONFIRMATION} to confirm<input className="pp-input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setBackup(undefined); }} autoComplete="off" disabled={busy} /></label>
              {!backup ? (
                <button type="button" className="pp-btn pp-btn--primary" onClick={downloadBackup} disabled={!armed || busy}>{busy ? phase || "Working…" : "Step 1: download a backup"}</button>
              ) : (
                <button type="button" className="pp-btn pp-btn--danger" onClick={clear} disabled={busy}>{busy ? phase || "Clearing…" : `Step 2: delete ${backup.ids.length} products`}</button>
              )}
            </div>
          )}
        </div>
      )}
      {busy && progress.total > 0 && <><Progress done={progress.done} total={progress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{phase}</div></>}
      <Msg message={message} />
    </>
  );
}

// The clear popup: pick which areas of the store to clear. Only the catalog can be cleared so far; the
// others appear greyed out, like the sections when importing.
function ClearSection({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Section danger title="Clear your store" hint="Clear products, and soon other areas of the store, in bulk. A snapshot of what will be deleted is downloaded first, and nothing is deleted until you have it.">
      <button type="button" className="pp-btn pp-btn--danger" onClick={() => setOpen(true)} disabled={!canWrite}>Clear sections…</button>
      {open && (
        <Modal title="Clear sections" onClose={() => setOpen(false)} wide footer={<button type="button" className="pp-btn" onClick={() => setOpen(false)}>Close</button>}>
          <ul className="pp-sections">
            {SAMPLE_SECTIONS.map((section) => (
              <li key={section.id} className={section.id === "catalog" ? "" : "is-off"}>
                <label>
                  <input type="checkbox" checked={section.id === "catalog"} disabled readOnly />
                  <span>
                    <strong>{section.label}</strong>
                    {section.id === "catalog" ? <span className="pp-muted">Products and their images. Choose below whether to clear everything or only what this app created.</span> : <span className="pp-muted">{section.description}</span>}
                    {section.id !== "catalog" && <em>Clearing this isn&apos;t available yet</em>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 20 }}><ClearBody storeHash={storeHash} canWrite={canWrite} /></div>
        </Modal>
      )}
    </Section>
  );
}

function OlderCatalogs({ storeHash, packs }: { storeHash: string | undefined; packs: PackSummary[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>();

  const remove = async (pack: PackSummary) => {
    if (!window.confirm(`Delete "${pack.name}" from the server? Download it first if you want to keep it. This can't be undone.`)) return;

    const result = await deletePackAction(storeHash, { packId: pack.id }).catch(() => undefined);

    setMessage(result?.ok ? { ok: true, text: `Deleted "${pack.name}".` } : { ok: false, text: result && !result.ok ? result.message : "Couldn't delete it." });
    router.refresh();
  };

  return (
    <Section title="Older saved catalogs" hint="These were saved on the server before snapshots became downloads. Open one to download it as a snapshot, then delete it from here. They can't be loaded into a store directly any more.">
      <PackGrid>
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            badge={pack.source === "backup" ? "Backup" : undefined}
            byline={pack.createdByEmail ? `Saved by ${pack.createdByEmail}` : undefined}
            actions={
              <>
                <Link className="pp-btn pp-btn--primary" href={getAppUrl(storeHash, `/catalog/personal/${encodeURIComponent(pack.id)}`)}>Open</Link>
                <button type="button" className="pp-btn" onClick={() => remove(pack)}>Delete</button>
              </>
            }
          />
        ))}
      </PackGrid>
      <Msg message={message} />
    </Section>
  );
}

export function RestoreView(props: Props) {
  return (
    <>
      {!props.canWrite && <section className="pp-card pp-section"><h2>Demo data mode</h2><p className="pp-section__hint">There is no store to read or change here. Set <code>DATA_MODE=STATIC</code> with a store token, or install the app, to use these tools.</p></section>}
      <DownloadSection storeHash={props.storeHash} canWrite={props.canWrite} />
      <UploadSnapshot storeHash={props.storeHash} canWrite={props.canWrite} />
      <ClearSection storeHash={props.storeHash} canWrite={props.canWrite} />
      {props.packs.length > 0 && <OlderCatalogs storeHash={props.storeHash} packs={props.packs} />}
    </>
  );
}
