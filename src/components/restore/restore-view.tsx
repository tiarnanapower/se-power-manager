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
import { CLEAR_REASONS, CLEARABLE_SECTIONS, isClearable, type ClearableSection } from "@/lib/samples/sections/clear";
import { clearSectionStepAction, previewSectionsClearAction } from "@/app/store/[storeHash]/catalog/personal/section-clear-actions";
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

type Backup = { file: string; ids: number[]; sections: ClearableSection[] };
type Counts = Record<string, { count: number; sample: string[] }>;

const LABELS: Record<string, string> = Object.fromEntries(SAMPLE_SECTIONS.map((section) => [section.id, section.label]));
const listOf = (ids: string[]) => ids.map((id) => LABELS[id] ?? id).join(", ");

// Clearing always starts with a download: a snapshot of exactly what is about to be deleted.
function ClearBody({ storeHash, canWrite, picked }: { storeHash: string | undefined; canWrite: boolean; picked: Set<string> }) {
  const router = useRouter();
  const [scope, setScope] = useState<"demo" | "all">("demo");
  const [counts, setCounts] = useState<Counts>();
  const [confirmation, setConfirmation] = useState("");
  const [backup, setBackup] = useState<Backup>();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<Message>();
  const [notes, setNotes] = useState<string[]>([]);

  const others = CLEARABLE_SECTIONS.filter((id) => picked.has(id));
  const withCatalog = picked.has("catalog");
  const pickKey = [...picked].sort().join(",");

  // Anything that changes what would be deleted starts the two steps over.
  const [seen, setSeen] = useState(pickKey);

  if (seen !== pickKey) {
    setSeen(pickKey);
    setCounts(undefined);
    setConfirmation("");
    setBackup(undefined);
    setMessage(undefined);
  }

  const reset = (next: "demo" | "all") => {
    setScope(next);
    setCounts(undefined);
    setConfirmation("");
    setBackup(undefined);
    setMessage(undefined);
  };

  const total = counts ? Object.values(counts).reduce((sum, entry) => sum + entry.count, 0) : 0;

  const runPreview = async () => {
    setBusy(true);
    setMessage(undefined);

    try {
      const found: Counts = {};

      if (withCatalog) {
        const result = await previewClearAction(storeHash, { scope });

        if (!result.ok) return setMessage({ ok: false, text: result.message });

        found.catalog = result.preview;
      }

      if (others.length > 0) {
        const result = await previewSectionsClearAction(storeHash, { sections: others });

        if (!result.ok) return setMessage({ ok: false, text: result.message });

        Object.assign(found, result.previews);
      }

      setCounts(found);
    } catch {
      setMessage({ ok: false, text: "Couldn't count what would be deleted. Try again." });
    } finally {
      setBusy(false);
    }
  };

  // Step 1: download a snapshot of what would be deleted. Nothing is deleted yet.
  const downloadBackup = async () => {
    setBusy(true);
    setMessage(undefined);

    try {
      let ids: number[] = [];

      if (withCatalog) {
        const started = await startClearAction(storeHash, { scope, confirmation });

        if (!started.ok) return setMessage({ ok: false, text: started.message });

        ids = started.start.ids;
      }

      if (ids.length === 0 && others.length === 0) return setMessage({ ok: true, text: "Nothing to clear." });

      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const snapshot = await buildStoreSnapshot(storeHash, {
        name: `Backup before clearing (${listOf([...(withCatalog ? ["catalog"] : []), ...others])})`,
        slug: `backup-${stamp}`,
        notes: "Saved before a bulk clear.",
        sections: others,
        ids,
        onProgress: (stage, fraction) => {
          setPhase(stage);
          setProgress({ done: Math.round(fraction * 100), total: 100 });
        },
      });

      downloadBytes(snapshot.file, snapshot.bytes);
      setBackup({ file: snapshot.file, ids, sections: [...others] });
      setMessage({ ok: true, text: `Downloaded ${snapshot.file} with ${snapshot.counts.products} products and ${snapshot.counts.images} pictures${others.length ? `, plus ${listOf(others)}` : ""}. Check it saved, then delete.` });
    } catch (failure) {
      setMessage({ ok: false, text: `Nothing was deleted. The backup couldn't be made: ${failure instanceof Error ? failure.message : "unknown error"}` });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  // Step 2: delete, once the backup has been downloaded. Other sections go first, the catalog last.
  const clear = async () => {
    if (!backup) return;

    setBusy(true);
    setMessage(undefined);
    setNotes([]);

    const problems: string[] = [];
    const done: string[] = [];

    try {
      for (const id of backup.sections) {
        setPhase(`Clearing ${LABELS[id] ?? id}…`);

        let deleted = 0;

        for (let pass = 0; pass < 500; pass += 1) {
          const result = await clearSectionStepAction(storeHash, { section: id, confirmation: CLEAR_CONFIRMATION });

          if (!result.ok) {
            problems.push(`${LABELS[id] ?? id}: ${result.message}`);
            break;
          }

          deleted += result.step.deleted;
          problems.push(...result.step.warnings);
          setNotes(problems.slice(0, 40));

          if (result.step.remaining === 0 || result.step.deleted === 0) break;
        }

        done.push(`${deleted} from ${LABELS[id] ?? id}`);
      }

      if (backup.ids.length > 0) {
        setPhase("Clearing the catalog…");
        setProgress({ done: 0, total: backup.ids.length });

        let deleted = 0;

        for (let start = 0; start < backup.ids.length; start += CLEAR_BATCH_SIZE) {
          const result = await clearBatchAction(storeHash, { scope, ids: backup.ids.slice(start, start + CLEAR_BATCH_SIZE) });

          if (!result.ok) return setMessage({ ok: false, text: `${result.message} ${deleted} products deleted before it stopped. Your backup is ${backup.file}.` });

          deleted += result.batch.deleted;
          setProgress({ done: deleted, total: backup.ids.length });
        }

        done.push(`${deleted} products`);
      }

      setMessage({ ok: problems.length === 0, text: `Cleared ${done.join(", ")}.${problems.length ? ` ${problems.length} item${problems.length === 1 ? "" : "s"} couldn't be removed (see below).` : ""} To undo, upload ${backup.file} above.` });
      setCounts(undefined);
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

  const armed = Boolean(counts && total > 0 && confirmation === CLEAR_CONFIRMATION);

  return (
    <>
      {withCatalog && (
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }} disabled={busy}>
          <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}><input type="radio" name="scope" checked={scope === "demo"} onChange={() => reset("demo")} /> Catalog: only products this app created</label>
          <label style={{ display: "block", fontSize: 14 }}><input type="radio" name="scope" checked={scope === "all"} onChange={() => reset("all")} /> Catalog: the whole catalog</label>
        </fieldset>
      )}
      <button type="button" className="pp-btn" onClick={runPreview} disabled={busy || !canWrite || picked.size === 0}>Count what would be deleted</button>
      {counts && (
        <div style={{ marginTop: 14 }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {Object.entries(counts).map(([id, entry]) => <li key={id}><strong>{entry.count}</strong> in {LABELS[id] ?? id}{entry.sample.length ? `, including ${entry.sample.join(", ")}` : ""}</li>)}
          </ul>
          {total > 0 && (
            <div style={{ marginTop: 12 }}>
              <label className="pp-field">Type {CLEAR_CONFIRMATION} to confirm<input className="pp-input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setBackup(undefined); }} autoComplete="off" disabled={busy} /></label>
              {!backup ? (
                <button type="button" className="pp-btn pp-btn--primary" onClick={downloadBackup} disabled={!armed || busy}>{busy ? phase || "Working…" : "Step 1: download a backup"}</button>
              ) : (
                <button type="button" className="pp-btn pp-btn--danger" onClick={clear} disabled={busy}>{busy ? phase || "Clearing…" : `Step 2: delete ${total} item${total === 1 ? "" : "s"}`}</button>
              )}
            </div>
          )}
        </div>
      )}
      {busy && progress.total > 0 && <><Progress done={progress.done} total={progress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{phase}</div></>}
      <Msg message={message} />
      {notes.length > 0 && <ul className="pp-errlist">{notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
    </>
  );
}

// The clear popup: pick which areas of the store to clear. Settings-only sections can't be deleted, so
// they are greyed out with the reason.
function ClearSection({ storeHash, canWrite }: { storeHash: string | undefined; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(["catalog"]));

  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    return next;
  });

  return (
    <Section danger title="Clear your store" hint="Clear the catalog and other areas of the store in bulk. A snapshot of what will be deleted is downloaded first, and nothing is deleted until you have it.">
      <button type="button" className="pp-btn pp-btn--danger" onClick={() => setOpen(true)} disabled={!canWrite}>Clear sections…</button>
      {open && (
        <Modal title="Clear sections" onClose={() => setOpen(false)} wide footer={<button type="button" className="pp-btn" onClick={() => setOpen(false)}>Close</button>}>
          <ul className="pp-sections">
            {SAMPLE_SECTIONS.map((section) => {
              const ready = section.id === "catalog" || isClearable(section.id);

              return (
                <li key={section.id} className={ready ? "" : "is-off"}>
                  <label>
                    <input type="checkbox" checked={ready && picked.has(section.id)} disabled={!ready} onChange={() => toggle(section.id)} />
                    <span>
                      <strong>{section.label}</strong>
                      <span className="pp-muted">{section.id === "catalog" ? "Products and their images. Choose below whether to clear everything or only what this app created." : ready ? CLEAR_WHAT[section.id] : section.description}</span>
                      {!ready && <em>{CLEAR_REASONS[section.id] ?? "Can't be cleared."}</em>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 20 }}><ClearBody storeHash={storeHash} canWrite={canWrite} picked={picked} /></div>
        </Modal>
      )}
    </Section>
  );
}

const CLEAR_WHAT: Record<string, string> = {
  shipping: "Deletes shipping zones and their methods. The default zone stays but loses its methods.",
  tax: "Deletes tax rates, zones and custom tax classes. Tax settings stay as they are.",
  pricing: "Deletes price lists (with their prices and assignments) and extra currencies. The default currency stays.",
  inventory: "Deletes stock locations. The default location can't be removed. Inventory settings stay.",
  b2b: "Deletes every B2B company with its users, and custom roles. This can't be undone except from the backup.",
};

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
