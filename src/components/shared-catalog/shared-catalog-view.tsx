"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { publishPackAction, unpublishPackAction } from "@/app/store/[storeHash]/catalog/shared/actions";
import { PackCard, PackGrid } from "@/components/packs/pack-card";
import type { PackSummary } from "@/lib/app-data/types";
import { getAppUrl } from "@/lib/routing/app-url";

interface Props {
  storeHash: string | undefined;
  // This store's identity as saved on its packs, so Remove only shows on its own.
  ownStoreHash: string;
  published: PackSummary[];
  candidates: PackSummary[];
}

type Message = { ok: boolean; text: string } | undefined;

const NAME_KEY = "se-power-manager:publisher-name";

// The publisher's display name is remembered in this browser so it doesn't
// have to be retyped. Storage can be unavailable, so every access is guarded.
function readName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

// localStorage changes only via this component, which re-renders itself, so there is
// nothing to subscribe to.
function subscribeNever(): () => void {
  return () => {};
}

function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not persisted; the name just has to be typed again next time.
  }
}

function PublishForm({ storeHash, candidates }: Pick<Props, "storeHash" | "candidates">) {
  const router = useRouter();
  const [packId, setPackId] = useState("");
  // The remembered name is read through useSyncExternalStore so the server render
  // (no localStorage) and first client render agree; anything typed overrides it.
  const stored = useSyncExternalStore(subscribeNever, readName, () => "");
  const [typedName, setName] = useState<string | undefined>();
  const name = typedName ?? stored;
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  const selected = candidates.find((pack) => pack.id === packId) ?? candidates[0];

  const choose = (id: string) => {
    setPackId(id);
    setDescription(candidates.find((pack) => pack.id === id)?.description ?? "");
  };

  const publish = async () => {
    if (!selected) return;

    setBusy(true);
    setMessage(undefined);

    try {
      const result = await publishPackAction(storeHash, { packId: selected.id, publishedBy: name, description: description || (selected.description || undefined) });

      if (result.ok) {
        rememberName(name.trim());
        setMessage({ ok: true, text: `"${result.pack.name}" is now in the Shared Catalog.` });
        setPackId("");
        setDescription("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    } catch {
      setMessage({ ok: false, text: "Couldn't publish. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pp-card pp-section">
      <h2>Publish a pack</h2>
      <p className="pp-section__hint">Share one of your saved packs with the team. It appears below under the name you add.</p>
      {candidates.length === 0 ? (
        <div className="pp-empty">
          Nothing to publish. <Link href={getAppUrl(storeHash, "/catalog/restore")}>Save your catalog as a pack</Link> first.
        </div>
      ) : (
        <>
          <label className="pp-field">Pack
            <select className="pp-input" value={selected?.id ?? ""} onChange={(event) => choose(event.target.value)} disabled={busy}>
              {candidates.map((pack) => <option key={pack.id} value={pack.id}>{pack.name} · {pack.productCount} products</option>)}
            </select>
          </label>
          <label className="pp-field">Your name<input className="pp-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Alex Smith" disabled={busy} /></label>
          <label className="pp-field">Description (optional)<input className="pp-input" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder={selected?.description || "What's in this pack, and who it suits"} disabled={busy} /></label>
          <button type="button" className="pp-btn pp-btn--primary" onClick={publish} disabled={busy || !name.trim() || !selected}>{busy ? "Publishing…" : "Publish to Shared Catalog"}</button>
        </>
      )}
      {message && <div role="status" className={`pp-msg ${message.ok ? "pp-msg--ok" : "pp-msg--err"}`}>{message.text}</div>}
    </section>
  );
}

function PublishedList({ storeHash, ownStoreHash, published }: Pick<Props, "storeHash" | "ownStoreHash" | "published">) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>();

  const unpublish = async (pack: PackSummary) => {
    if (!window.confirm(`Remove "${pack.name}" from the Shared Catalog? The pack stays in the library.`)) return;

    const result = await unpublishPackAction(storeHash, { packId: pack.id }).catch(() => undefined);

    setMessage(result?.ok ? { ok: true, text: `Removed "${pack.name}".` } : { ok: false, text: result && !result.ok ? result.message : "Couldn't remove the pack." });
    router.refresh();
  };

  return (
    <section className="pp-card pp-section">
      <h2>Shared Catalog</h2>
      <p className="pp-section__hint">Packs the team has published. Restore one into your store from Restore &amp; Clear.</p>
      {published.length === 0 ? (
        <div className="pp-empty">Nothing published yet. Be the first.</div>
      ) : (
        <PackGrid>
          {published.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              byline={pack.publishedBy ? `Added by ${pack.publishedBy}` : undefined}
              actions={
                <>
                  <Link className="pp-btn pp-btn--primary" href={getAppUrl(storeHash, `/catalog/restore?pack=${encodeURIComponent(pack.id)}#restore`)}>Use this pack</Link>
                  {pack.storeHash === ownStoreHash && <button type="button" className="pp-btn" onClick={() => unpublish(pack)}>Remove</button>}
                </>
              }
            />
          ))}
        </PackGrid>
      )}
      {message && <div role="status" className={`pp-msg ${message.ok ? "pp-msg--ok" : "pp-msg--err"}`}>{message.text}</div>}
    </section>
  );
}

export function SharedCatalogView({ storeHash, ownStoreHash, published, candidates }: Props) {
  return (
    <>
      <PublishedList storeHash={storeHash} ownStoreHash={ownStoreHash} published={published} />
      <PublishForm storeHash={storeHash} candidates={candidates} />
    </>
  );
}
