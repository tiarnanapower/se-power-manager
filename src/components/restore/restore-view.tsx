"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearBatchAction, deletePackAction, preserveImagesAction, previewClearAction, restoreBatchAction, savePackAction, startClearAction } from "@/app/store/[storeHash]/catalog/restore/actions";
import { PackCard, PackGrid } from "@/components/packs/pack-card";
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

const packLabel = (pack: PackSummary) => `${pack.name} · ${pack.productCount} products${pack.createdByEmail ? ` · ${pack.createdByEmail}` : ""}`;

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

function RestoreSection({ storeHash, packs, canWrite, initialPackId }: Props) {
  const router = useRouter();
  const [packId, setPackId] = useState(initialPackId ?? packs[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, created: 0, skipped: 0, failed: 0, imagesMissing: 0 });
  const [errors, setErrors] = useState<{ name: string; reason: string }[]>([]);
  const [differences, setDifferences] = useState<{ name: string; detail: string }[]>([]);
  const [message, setMessage] = useState<Message>();
  const cancel = useRef(false);
  const selected = packs.find((pack) => pack.id === (packId || packs[0]?.id));

  const restore = async () => {
    if (!selected) return;

    cancel.current = false;
    setRunning(true);
    setMessage(undefined);
    setErrors([]);
    setDifferences([]);

    const totals = { done: 0, total: selected.productCount, created: 0, skipped: 0, failed: 0, imagesMissing: 0 };
    const collected: { name: string; reason: string }[] = [];
    const differing: { name: string; detail: string }[] = [];

    setProgress(totals);

    try {
      let offset = 0;

      for (;;) {
        if (cancel.current) {
          setMessage({ ok: false, text: `Stopped. ${totals.created} created, ${totals.skipped} skipped, ${totals.failed} failed. Products already created stay in your store.` });
          break;
        }

        const result = await restoreBatchAction(storeHash, { packId: selected.id, offset });

        if (!result.ok) {
          setMessage({ ok: false, text: result.message });
          break;
        }

        const { batch } = result;

        totals.done = batch.nextOffset;
        totals.total = batch.total;
        totals.created += batch.created;
        totals.skipped += batch.skipped;
        totals.failed += batch.failed;
        totals.imagesMissing += batch.imagesMissing;
        collected.push(...batch.errors);
        differing.push(...batch.differences);
        setDifferences(differing.slice(0, 50));
        setProgress({ ...totals });
        setErrors(collected.slice(0, 50));

        if (batch.done || batch.nextOffset <= offset) {
          setMessage({ ok: totals.failed === 0, text: `Done. ${totals.created} created, ${totals.skipped} skipped, ${totals.failed} failed.${totals.imagesMissing ? ` ${totals.imagesMissing} images no longer existed and were left out.` : ""}` });
          break;
        }

        offset = batch.nextOffset;
      }
    } catch {
      setMessage({ ok: false, text: "Lost contact with the server. Products already created stay in your store." });
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  return (
    <Section half id="restore" title="Restore a pack into your store" hint="Creates the pack's products here. Categories and brands are matched by name, and created if missing. Products whose SKU already exists are skipped.">
      {packs.length === 0 ? (
        <div className="pp-empty">No packs yet. Save one above.</div>
      ) : (
        <>
          <label className="pp-field">Pack
            <select className="pp-input" value={selected?.id ?? ""} onChange={(event) => setPackId(event.target.value)} disabled={running}>
              {packs.map((pack) => <option key={pack.id} value={pack.id}>{packLabel(pack)}</option>)}
            </select>
          </label>
          <div className="pp-row">
            <button type="button" className="pp-btn pp-btn--primary" onClick={restore} disabled={running || !canWrite || !selected}>{running ? "Restoring…" : `Restore ${selected?.productCount ?? 0} products`}</button>
            {running && <button type="button" className="pp-btn" onClick={() => { cancel.current = true; }}>Stop after this batch</button>}
          </div>
          {(running || progress.total > 0) && (
            <>
              <Progress done={progress.done} total={progress.total} />
              <div className="pp-muted" style={{ fontSize: 13 }}>{progress.done} of {progress.total} processed · {progress.created} created · {progress.skipped} skipped · {progress.failed} failed{progress.imagesMissing ? ` · ${progress.imagesMissing} missing images` : ""}</div>
            </>
          )}
          <Msg message={message} />
          {errors.length > 0 && <ul className="pp-errlist">{errors.map((error, index) => <li key={`${error.name}-${index}`}><strong>{error.name}</strong>: {error.reason}</li>)}</ul>}
          {differences.length > 0 && (
            <>
              <p className="pp-note"><strong>Not an exact copy:</strong> these products were created, but something didn&apos;t come through.</p>
              <ul className="pp-errlist">{differences.map((item, index) => <li key={`${item.name}-${index}`}><strong>{item.name}</strong>: {item.detail}</li>)}</ul>
            </>
          )}
          <p className="pp-note">BigCommerce fetches each image from the pack&apos;s saved copy while creating the product. Packs marked &quot;Images not saved&quot; only link to the source store&apos;s images, which are removed when those products are deleted, so those pictures are left out.</p>
        </>
      )}
    </Section>
  );
}

function ClearSection({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
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

      setMessage({ ok: true, text: `Cleared ${deleted} products. Backup saved as "${backup.name}"; restore it above to undo.${imageNote}` });
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
    <Section danger title="Clear products" hint="Deletes products from your store in bulk. A backup pack is saved first, images included, and nothing is deleted if that fails.">
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
    </Section>
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
    <Section title="Pack library" hint="Packs saved by this store, including automatic backups from clears. They are private to this store.">
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
                  <Link className="pp-btn" href={getAppUrl(storeHash, `/catalog/restore?pack=${encodeURIComponent(pack.id)}#restore`)}>Restore this pack</Link>
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
      <RestoreSection key={props.initialPackId ?? "none"} {...props} />
      <ClearSection storeHash={props.storeHash} canWrite={props.canWrite} />
      <PackList storeHash={props.storeHash} packs={props.packs} />
    </>
  );
}
