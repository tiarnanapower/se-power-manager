"use client";

import { useRef, useState } from "react";
import { restoreBatchAction } from "@/app/store/[storeHash]/catalog/restore/actions";
import { saveImportPackAction, scrapeUrlAction } from "@/app/store/[storeHash]/catalog/import/actions";
import type { ScrapedProduct } from "@/lib/import/scrape";

interface Props {
  storeHash: string | undefined;
  aiConfigured: boolean;
  canWrite: boolean;
}

interface Row extends ScrapedProduct {
  key: number;
  keep: boolean;
}

type Message = { ok: boolean; text: string } | undefined;

function Msg({ message }: { message: Message }) {
  return message ? <div role="status" className={`pp-msg ${message.ok ? "pp-msg--ok" : "pp-msg--err"}`}>{message.text}</div> : null;
}

function Progress({ done, total }: { done: number; total: number }) {
  return <div className="pp-progress" aria-hidden="true"><span style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></div>;
}

const parseUrls = (text: string) => [...new Set(text.split(/\s+/).map((part) => part.trim()).filter(Boolean))].slice(0, 10);

export function ImportView({ storeHash, aiConfigured, canWrite }: Props) {
  const [urlText, setUrlText] = useState("");
  const [limit, setLimit] = useState(20);
  const [rows, setRows] = useState<Row[]>([]);
  const [scraping, setScraping] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState({ done: 0, total: 0 });
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<Message>();
  const [packName, setPackName] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0 });
  const [pushIssues, setPushIssues] = useState<string[]>([]);
  const [pushMessage, setPushMessage] = useState<Message>();
  const nextKey = useRef(0);
  const kept = rows.filter((row) => row.keep && row.name.trim());

  const scrape = async () => {
    const urls = parseUrls(urlText);

    if (urls.length === 0) return setMessage({ ok: false, text: "Paste at least one web address." });

    setScraping(true);
    setMessage(undefined);
    setProblems([]);
    setPushMessage(undefined);
    setScrapeProgress({ done: 0, total: urls.length });

    const found: Row[] = [];
    const failed: string[] = [];

    for (const [index, url] of urls.entries()) {
      try {
        const result = await scrapeUrlAction(storeHash, { url, limit });

        if (result.ok) found.push(...result.products.map((product) => ({ ...product, key: nextKey.current++, keep: true })));
        else failed.push(`${url}: ${result.message}`);
      } catch {
        failed.push(`${url}: lost contact with the server.`);
      }

      setScrapeProgress({ done: index + 1, total: urls.length });
    }

    setRows((current) => [...current, ...found]);
    setProblems(failed);
    setMessage(found.length ? { ok: true, text: `Found ${found.length} product${found.length === 1 ? "" : "s"}. Review them below before anything is written.` } : { ok: false, text: "No products found." });

    if (found.length && !packName) setPackName(`Import: ${new URL(found[0].sourceUrl).hostname} ${new Date().toISOString().slice(0, 10)}`);

    setScraping(false);
  };

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeImage = (key: number, url: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, imageUrls: row.imageUrls.filter((image) => image !== url) } : row)));
  const payload = () => kept.map(({ key: _key, keep: _keep, ...product }) => ({ ...product, name: product.name.trim(), sku: product.sku?.trim() || null, brand: product.brand?.trim() || null, category: product.category?.trim() || null }));

  const save = async (push: boolean) => {
    setPushing(true);
    setPushMessage(undefined);
    setPushIssues([]);
    setPushProgress({ done: 0, total: kept.length });

    try {
      const saved = await saveImportPackAction(storeHash, { name: packName.trim(), products: payload() });

      if (!saved.ok) return setPushMessage({ ok: false, text: saved.message });
      if (!push) return setPushMessage({ ok: true, text: `Saved as the pack "${saved.pack.name}". Find it under Restore & Clear, where you can restore or publish it.` });

      const totals = { created: 0, skipped: 0, failed: 0, imagesMissing: 0 };
      const issues: string[] = [];

      for (let offset = 0; ;) {
        const result = await restoreBatchAction(storeHash, { packId: saved.pack.id, offset });

        if (!result.ok) return setPushMessage({ ok: false, text: `${result.message} The pack "${saved.pack.name}" was saved, so nothing is lost.` });

        const { batch } = result;

        totals.created += batch.created;
        totals.skipped += batch.skipped;
        totals.failed += batch.failed;
        totals.imagesMissing += batch.imagesMissing;
        issues.push(...batch.errors.map((error) => `${error.name}: ${error.reason}`));
        setPushProgress({ done: batch.nextOffset, total: batch.total });
        setPushIssues(issues.slice(0, 50));

        if (batch.done || batch.nextOffset <= offset) {
          setPushMessage({ ok: totals.failed === 0, text: `Done. ${totals.created} created, ${totals.skipped} skipped, ${totals.failed} failed.${totals.imagesMissing ? ` ${totals.imagesMissing} images couldn't be fetched and were left out.` : ""} The pack "${saved.pack.name}" is saved too.` });
          break;
        }

        offset = batch.nextOffset;
      }
    } catch {
      setPushMessage({ ok: false, text: "Lost contact with the server. Anything already created stays in your store." });
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      <section className="pp-card pp-section">
        <h2>Scrape products</h2>
        <p className="pp-section__hint">Paste product or category page addresses, one per line (up to 10). AI reads each page and pulls out the products. Nothing is written to your store until you review and push.</p>
        {!aiConfigured && <div className="pp-warn">The AI gateway isn&apos;t configured. Add <code className="pp-code">PORTKEY_API_KEY</code> to the server environment to scrape.</div>}
        <div className="pp-scrape">
          <label className="pp-field">Page addresses
            <textarea className="pp-input" style={{ maxWidth: "100%", width: "100%", minHeight: 150, fontFamily: "inherit", boxSizing: "border-box" }} placeholder={"https://www.example.com/collections/shoes\nhttps://www.example.com/products/trail-runner"} value={urlText} onChange={(event) => setUrlText(event.target.value)} disabled={scraping} />
          </label>
          <div className="pp-scrape__side">
            <label className="pp-field">Most products from each page
              <input className="pp-input" type="number" min={1} max={50} value={limit} onChange={(event) => setLimit(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} disabled={scraping} style={{ maxWidth: 120 }} />
            </label>
            <div className="pp-row">
              <button type="button" className="pp-btn pp-btn--primary" onClick={scrape} disabled={scraping || !aiConfigured}>{scraping ? "Scraping…" : "Scrape products"}</button>
            </div>
            {(scraping || scrapeProgress.total > 0) && <><Progress done={scrapeProgress.done} total={scrapeProgress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{scrapeProgress.done} of {scrapeProgress.total} pages read</div></>}
            <Msg message={message} />
          </div>
        </div>
        {problems.length > 0 && <ul className="pp-errlist">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        <p className="pp-note">Pages that load their products with JavaScript, or that block automated requests, may come back empty. Product pages and server-rendered category pages work best.</p>
      </section>

      {rows.length > 0 && (
        <section className="pp-glass">
          <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>Review ({kept.length} of {rows.length} selected)</h2>
          <p className="pp-section__hint" style={{ margin: "0 0 22px" }}>Edit anything that looks wrong, untick products you don&apos;t want, and click an image to drop it.</p>
          <div className="pp-import">
            {rows.map((row) => (
              <div key={row.key} className={`pp-import__row${row.keep ? "" : " is-off"}`}>
                <input type="checkbox" checked={row.keep} onChange={(event) => update(row.key, { keep: event.target.checked })} aria-label={`Include ${row.name}`} />
                <div className="pp-import__imgs">
                  {row.imageUrls.length === 0 && <span className="pp-import__noimg">No image</span>}
                  {row.imageUrls.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <button type="button" key={url} className="pp-import__img" onClick={() => removeImage(row.key, url)} title="Remove this image"><img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /></button>
                  ))}
                </div>
                <div className="pp-import__fields">
                  <input className="pp-input pp-import__wide" value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} aria-label="Name" placeholder="Name" />
                  <input className="pp-input" type="number" min={0} step="0.01" value={row.price ?? ""} onChange={(event) => update(row.key, { price: event.target.value === "" ? null : Number(event.target.value) })} aria-label="Price" placeholder="Price" />
                  <input className="pp-input" value={row.sku ?? ""} onChange={(event) => update(row.key, { sku: event.target.value || null })} aria-label="SKU" placeholder="SKU" />
                  <input className="pp-input" value={row.brand ?? ""} onChange={(event) => update(row.key, { brand: event.target.value || null })} aria-label="Brand" placeholder="Brand" />
                  <input className="pp-input pp-import__wide" value={row.category ?? ""} onChange={(event) => update(row.key, { category: event.target.value || null })} aria-label="Category" placeholder="Category, e.g. Clothing > T-Shirts" />
                  <textarea className="pp-input pp-import__wide" rows={2} value={row.description} onChange={(event) => update(row.key, { description: event.target.value })} aria-label="Description" placeholder="Description" />
                </div>
              </div>
            ))}
          </div>

          <label className="pp-field" style={{ marginTop: 16 }}>Pack name
            <input className="pp-input" value={packName} onChange={(event) => setPackName(event.target.value)} disabled={pushing} />
          </label>
          <div className="pp-row">
            <button type="button" className="pp-btn pp-btn--primary" onClick={() => save(true)} disabled={pushing || !canWrite || kept.length === 0 || !packName.trim()}>{pushing ? "Working…" : `Push ${kept.length} to my store`}</button>
            <button type="button" className="pp-btn" onClick={() => save(false)} disabled={pushing || kept.length === 0 || !packName.trim()}>Save as pack only</button>
            <button type="button" className="pp-btn" onClick={() => { setRows([]); setMessage(undefined); setPushMessage(undefined); }} disabled={pushing}>Clear results</button>
          </div>
          {(pushing || pushProgress.total > 0) && <><Progress done={pushProgress.done} total={pushProgress.total} /><div className="pp-muted" style={{ fontSize: 13 }}>{pushProgress.done} of {pushProgress.total} processed</div></>}
          <Msg message={pushMessage} />
          {pushIssues.length > 0 && <ul className="pp-errlist">{pushIssues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}
          <p className="pp-note">Pushing saves the products as a pack first, then creates them in your store. Categories and brands are matched by name and created if missing. Created products are tracked so &quot;Clear demo products&quot; can remove exactly these.</p>
        </section>
      )}
    </>
  );
}
