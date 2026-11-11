"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearBatchAction, deletePackAction, preserveImagesAction, previewClearAction, savePackAction, startClearAction } from "@/app/store/[storeHash]/catalog/personal/actions";
import { PackCard, PackGrid } from "@/components/packs/pack-card";
import { Modal } from "@/components/samples/modal";
import { SAMPLE_SECTIONS } from "@/lib/samples/format";
import type { ImagesState, PackSummary } from "@/lib/app-data/types";
import { getAppUrl } from "@/lib/routing/app-url";
import { CLEAR_BATCH_SIZE, CLEAR_CONFIRMATION } from "@/lib/catalog/constants";

interface Props {
  storeHash: string | undefined;
  packs: PackSummary[];
  canWrite: boolean;
  // Whether pack images can be copied to durable storage (Vercel Blob).
  imageStorage: boolean;
  // Preselected in the restore list, e.g. arriving from the Shared Catalog.
  initialPackId?: string;
}

type Message = { ok: boolean; text: string } | undefined;

function Section({ id, title, hint, danger, half, children }: { id?: string; title: string; hint: string; danger?: boolean; half?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={`pp-card pp-section${danger ? " pp-danger-zone" : ""}${half ? " pp-half" : ""}`}>
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

type CopyOutcome = { ok: true; state: ImagesState; failed: number } | { ok: false; message: string };

// Copies a pack's images to durable storage, a few products per request, and
// reports progress as it goes.
async function copyPackImages(storeHash: string | undefined, packId: string, total: number, onProgress: (done: number, total: number) => void): Promise<CopyOutcome> {
  let offset = 0;
  let failed = 0;

  onProgress(0, total);

  for (;;) {
    const result = await preserveImagesAction(storeHash, { packId, offset });

    if (!result.ok) return { ok: false, message: result.message };

    failed += result.batch.failed;
    onProgress(result.batch.nextOffset, result.batch.total);

    if (result.batch.done || result.batch.nextOffset <= offset) return { ok: true, state: result.batch.state ?? "partial", failed };

    offset = result.batch.nextOffset;
  }
}

const IMAGES_NOT_SAVED = "Image backup isn't set up (no BLOB_READ_WRITE_TOKEN), so packs only link to your store's images. BigCommerce deletes those with the products, so a restored pack would have no pictures.";


function SaveSection({ storeHash, canWrite, imageStorage }: { storeHash: string | undefined; canWrite: boolean; imageStorage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<Message>();

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    setPhase("Saving products…");
    setProgress({ done: 0, total: 0 });

    try {
      const result = await savePackAction(storeHash, { name, description });

      if (!result.ok) {
        setMessage({ ok: false, text: result.message });

        return;
      }

      const { pack } = result;
      let text = `Saved "${pack.name}" with ${pack.productCount} products.`;

      if (pack.imagesState === "pending") {
        setPhase("Copying images…");

        const copied = await copyPackImages(storeHash, pack.id, pack.productCount, (done, total) => setProgress({ done, total }));

        if (!copied.ok) text += ` The images couldn't be copied (${copied.message}). The pack links to your store's images instead.`;
        else text += copied.failed ? ` Images copied, except ${copied.failed} that were already gone.` : " Images copied.";
      } else if (pack.imagesState === "skipped") {
        text += " Images were not copied: image storage isn't set up.";
      }

      setMessage({ ok: true, text });
      setName("");
      setDescription("");
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Couldn't save the pack. Try again." });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  return (
    <Section half title="Save this catalog as a pack" hint="Copies every product in your store (with variants, images, categories and brands) into your store's pack library. Packs are private to this store.">
      {!imageStorage && <div className="pp-warn" role="note">{IMAGES_NOT_SAVED}</div>}
      <label className="pp-field">Pack name<input className="pp-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Outdoor retailer, 40 products" /></label>
      <label className="pp-field">Description (optional)<input className="pp-input" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label>
      <button type="button" className="pp-btn pp-btn--primary" onClick={save} disabled={busy || !canWrite || !name.trim()}>{busy ? phase || "Saving…" : "Save pack"}</button>
      {busy && progress.total > 0 && <><Progress done={progress.done} total={progress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{phase} {progress.done} of {progress.total} products</div></>}
      <Msg message={message} />
    </Section>
  );
}

function ClearBody({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const router = useRouter();
  const [scope, setScope] = useState<"demo" | "all">("demo");
  const [preview, setPreview] = useState<{ count: number; sample: string[]; canPreserveImages: boolean } | undefined>();
  const [confirmation, setConfirmation] = useState("");
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<Message>();

  const changeScope = (next: "demo" | "all") => {
    setScope(next);
    setPreview(undefined);
    setConfirmation("");
    setAcceptLoss(false);
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

  const clear = async () => {
    setBusy(true);
    setMessage(undefined);
    setPhase("Saving a backup…");
    setProgress({ done: 0, total: 0 });

    try {
      const started = await startClearAction(storeHash, { scope, confirmation, acceptImageLoss: acceptLoss });

      if (!started.ok) {
        setMessage({ ok: false, text: started.message });

        return;
      }

      const { backup, ids } = started.start;

      if (!backup || ids.length === 0) {
        setMessage({ ok: true, text: "Nothing to clear." });

        return;
      }

      // Deleting a product deletes its images, so they are copied somewhere safe
      // first. Nothing is deleted until that has finished.
      let imageNote = "";

      if (backup.imagesState === "pending") {
        setPhase("Backing up images…");

        const copied = await copyPackImages(storeHash, backup.id, backup.productCount, (done, total) => setProgress({ done, total }));

        if (!copied.ok) {
          setMessage({ ok: false, text: `Nothing was deleted. The images couldn't be backed up: ${copied.message}` });

          return;
        }

        if (copied.failed) imageNote = ` ${copied.failed} images were already gone and couldn't be backed up.`;
      } else if (backup.imagesState === "skipped") {
        imageNote = " Images were not backed up, so they are lost.";
      }

      let deleted = 0;

      setPhase("Deleting…");
      setProgress({ done: 0, total: ids.length });

      for (let start = 0; start < ids.length; start += CLEAR_BATCH_SIZE) {
        const batchIds = ids.slice(start, start + CLEAR_BATCH_SIZE);
        const result = await clearBatchAction(storeHash, { backupPackId: backup.id, scope, ids: batchIds });

        if (!result.ok) {
          setMessage({ ok: false, text: `${result.message} ${deleted} deleted before it stopped. Your backup "${backup.name}" is in the library.` });

          return;
        }

        deleted += result.batch.deleted;
        setProgress({ done: deleted, total: ids.length });
      }

      setMessage({ ok: true, text: `Cleared ${deleted} products. Backup saved as "${backup.name}"; open it under Your saved catalogs to undo.${imageNote}` });
      setPreview(undefined);
      setConfirmation("");
      setAcceptLoss(false);
    } catch {
      setMessage({ ok: false, text: "Lost contact with the server. Check the Activity page for what completed." });
    } finally {
      setBusy(false);
      setPhase("");
      router.refresh();
    }
  };

  const needsAcceptance = Boolean(preview && !preview.canPreserveImages);
  const armed = Boolean(preview && preview.count > 0 && confirmation === CLEAR_CONFIRMATION && (!needsAcceptance || acceptLoss));

  return (
    <>
      <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }} disabled={busy}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}><input type="radio" name="scope" checked={scope === "demo"} onChange={() => changeScope("demo")} /> Only products this app created</label>
        <label style={{ display: "block", fontSize: 14 }}><input type="radio" name="scope" checked={scope === "all"} onChange={() => changeScope("all")} /> The whole catalog</label>
      </fieldset>
      <button type="button" className="pp-btn" onClick={runPreview} disabled={busy || !canWrite}>Count what would be deleted</button>
      {preview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14 }}><strong>{preview.count}</strong> product{preview.count === 1 ? "" : "s"} would be deleted{preview.sample.length ? `, including ${preview.sample.join(", ")}` : ""}.</div>
          {preview.count > 0 && needsAcceptance && (
            <div className="pp-warn" role="alert" style={{ marginTop: 12 }}>
              {IMAGES_NOT_SAVED} Clearing now would lose the product images permanently.
              <label style={{ display: "block", marginTop: 8, fontWeight: 600 }}><input type="checkbox" checked={acceptLoss} onChange={(event) => setAcceptLoss(event.target.checked)} disabled={busy} /> I understand the images will be lost</label>
            </div>
          )}
          {preview.count > 0 && (
            <div style={{ marginTop: 12 }}>
              <label className="pp-field">Type {CLEAR_CONFIRMATION} to confirm<input className="pp-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label>
              <button type="button" className="pp-btn pp-btn--danger" onClick={clear} disabled={!armed || busy}>{busy ? phase || "Clearing…" : `Back up and clear ${preview.count} products`}</button>
            </div>
          )}
        </div>
      )}
      {busy && progress.total > 0 && <><Progress done={progress.done} total={progress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{phase} {progress.done} of {progress.total}</div></>}
      <Msg message={message} />
    </>
  );
}

function PackList({ storeHash, packs }: { storeHash: string | undefined; packs: PackSummary[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>();

  const remove = async (pack: PackSummary) => {
    if (!window.confirm(`Delete the pack "${pack.name}"? This can't be undone.`)) return;

    const result = await deletePackAction(storeHash, { packId: pack.id }).catch(() => undefined);

    setMessage(result?.ok ? { ok: true, text: `Deleted "${pack.name}".` } : { ok: false, text: result && !result.ok ? result.message : "Couldn't delete the pack." });
    router.refresh();
  };

  return (
    <Section title="Your saved catalogs" hint="Open one to see what is inside and restore it. They include the automatic backups made before a clear, and are private to this store.">
      {packs.length === 0 ? (
        <div className="pp-empty">Nothing saved yet.</div>
      ) : (
        <PackGrid>
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              badge={pack.source === "backup" ? "Backup" : pack.publishedAt ? "Shared" : undefined}
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
      )}
      <Msg message={message} />
    </Section>
  );
}

export function RestoreView(props: Props) {
  return (
    <>
      {!props.canWrite && <section className="pp-card pp-section"><h2>Demo data mode</h2><p className="pp-section__hint">There is no store to read or change here. Set <code>DATA_MODE=STATIC</code> with a store token, or install the app, to use these tools.</p></section>}
      <SaveSection storeHash={props.storeHash} canWrite={props.canWrite} imageStorage={props.imageStorage} />
      <ClearSection storeHash={props.storeHash} canWrite={props.canWrite} />
      <PackList storeHash={props.storeHash} packs={props.packs} />
    </>
  );
}


// The clear popup: pick which areas of the store to clear. Only the catalog can be cleared so far; the
// others appear greyed out, like the sections when importing a sample.
function ClearSection({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Section danger title="Clear your store" hint="Clear products, and soon other areas of the store, in bulk. A backup pack is saved first, images included, and nothing is deleted if that fails.">
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
