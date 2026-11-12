"use client";

import { useRef, useState } from "react";
import { finishWawaweewaPickListsAction, importWawaweewaB2bAction, importWawaweewaBatchAction, planWawaweewaAction, planWawaweewaB2bAction } from "@/app/store/[storeHash]/utilities/wawaweewa/actions";
import { Section } from "@/components/features/ui";
import { SampleImage } from "@/components/samples/sample-image";
import type { SourcePreview } from "@/lib/wawaweewa/source";

type Phase = "choose" | "running" | "done";

const money = (value: number | null) => (value === null ? "" : value.toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function WawaweewaView({ storeHash, preview, sourceLabel, canWrite }: { storeHash: string | undefined; preview: SourcePreview; sourceLabel: string; canWrite: boolean }) {
  const [wantCatalog, setWantCatalog] = useState(preview.productTotal > 0);
  const [wantB2b, setWantB2b] = useState((preview.companyTotal ?? 0) > 0);
  const [phase, setPhase] = useState<Phase>("choose");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState({ created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0, companies: 0, companiesSkipped: 0 });
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const cancel = useRef(false);

  const nothing = (!wantCatalog || preview.productTotal === 0) && (!wantB2b || !preview.companyTotal);

  const run = async () => {
    cancel.current = false;
    setPhase("running");
    setError(undefined);
    setIssues([]);

    const sum = { created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0, companies: 0, companiesSkipped: 0 };
    const notes: string[] = [];
    const show = () => {
      setTotals({ ...sum });
      setIssues(notes.slice(0, 80));
    };
    const stopped = () => {
      if (!cancel.current) return false;

      setError("Stopped. Anything already created stays in your store.");

      return true;
    };

    setTotals({ ...sum });

    try {
      if (wantCatalog) {
        setStage("Reading the source catalog");
        setProgress({ done: 0, total: preview.productTotal });

        const plan = await planWawaweewaAction(storeHash);

        if (!plan.ok) throw new Error(plan.message);

        const { ids, refs } = plan.plan;

        setProgress({ done: 0, total: ids.length });
        setStage("Importing products");

        for (let at = 0; at < ids.length; at += 10) {
          if (stopped()) return;

          const result = await importWawaweewaBatchAction(storeHash, { ids: ids.slice(at, at + 10), refs, offset: at, total: ids.length });

          if (!result.ok) throw new Error(result.message);

          const { batch } = result;

          sum.created += batch.created;
          sum.skipped += batch.skipped;
          sum.failed += batch.failed;
          sum.imagesMissing += batch.imagesMissing;
          notes.push(...batch.errors.map((entry) => `${entry.name}: ${entry.reason}`), ...batch.differences.map((entry) => `${entry.name}: ${entry.detail}`));
          setProgress({ done: Math.min(ids.length, at + 10), total: ids.length });
          show();
        }

        // Pick lists point at other products, so they wait until every product exists.
        setStage("Linking pick lists");

        for (let at = 0; at < ids.length; at += 20) {
          if (stopped()) return;

          const result = await finishWawaweewaPickListsAction(storeHash, { ids: ids.slice(at, at + 20), refs });

          if (!result.ok) {
            notes.push(`Pick lists: ${result.message}`);
            break;
          }

          sum.pickLists += result.created;
          notes.push(...result.warnings.map((entry) => `${entry.name}: ${entry.detail}`));
          show();
        }
      }

      if (wantB2b) {
        setStage("Reading the source B2B companies");
        setProgress({ done: 0, total: 0 });

        const plan = await planWawaweewaB2bAction(storeHash);

        if (!plan.ok) throw new Error(plan.message);

        notes.push(...plan.warnings);

        const { companies } = plan;

        setProgress({ done: 0, total: companies.length });
        setStage("Importing B2B companies and users");

        for (let at = 0; at < companies.length; at += 3) {
          if (stopped()) return;

          const result = await importWawaweewaB2bAction(storeHash, { companies: companies.slice(at, at + 3) });

          if (!result.ok) throw new Error(result.message);

          sum.companies += result.result.created;
          sum.companiesSkipped += result.result.skipped;
          notes.push(...result.result.warnings);
          setProgress({ done: Math.min(companies.length, at + 3), total: companies.length });
          show();
        }
      }

      show();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Lost contact with the server. Anything already created stays in your store.");
    } finally {
      setPhase("done");
    }
  };

  return (
    <>
      <Section title="Source store" hint={`Connected to ${sourceLabel}. Wawaweewa only reads from it: nothing in the source store is changed.`}>
        <dl className="pp-sample__stats">
          <div><dt>Products</dt><dd>{preview.productTotal}</dd></div>
          <div><dt>B2B companies</dt><dd>{preview.companyTotal ?? "—"}</dd></div>
        </dl>
        {preview.problems.map((problem) => <div key={problem} className="pp-warn" style={{ marginTop: 12 }}>{problem}</div>)}
      </Section>

      <Section title="What to import" hint="Pick what to bring into your store. Existing products with the same SKU and companies with the same name are skipped, and nothing is deleted.">
        <ul className="pp-sections">
          <li className={preview.productTotal > 0 ? "" : "is-off"}>
            <label>
              <input type="checkbox" checked={wantCatalog && preview.productTotal > 0} disabled={preview.productTotal === 0 || phase === "running"} onChange={(event) => setWantCatalog(event.target.checked)} />
              <span>
                <strong>Catalog</strong>
                <span className="pp-muted">Products, categories, brands, variants, options, custom fields, pick lists and pictures.</span>
              </span>
            </label>
          </li>
          <li className={preview.companyTotal ? "" : "is-off"}>
            <label>
              <input type="checkbox" checked={wantB2b && Boolean(preview.companyTotal)} disabled={!preview.companyTotal || phase === "running"} onChange={(event) => setWantB2b(event.target.checked)} />
              <span>
                <strong>B2B companies and users</strong>
                <span className="pp-muted">Each company with its administrator and other users. Quotes, orders and custom roles aren&apos;t included. Your store needs B2B Edition.</span>
              </span>
            </label>
          </li>
        </ul>
        {preview.products.length > 0 && (
          <>
            <p className="pp-section__hint" style={{ marginTop: 18 }}>A look at the catalog ({preview.products.length} of {preview.productTotal}):</p>
            <div className="pp-sample__products">
              {preview.products.map((product, index) => (
                <div key={`${product.sku}-${index}`} className="pp-sample__product" style={{ cursor: "default" }}>
                  <SampleImage src={product.image} storeHash={storeHash} className="pp-sample__thumb" />
                  <span className="pp-sample__name">{product.name}</span>
                  <span className="pp-muted pp-sample__meta">{product.sku || "No SKU"} {money(product.price) && `· ${money(product.price)}`}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {preview.companies.length > 0 && (
          <>
            <p className="pp-section__hint" style={{ marginTop: 18 }}>A look at the companies ({preview.companies.length} of {preview.companyTotal}):</p>
            <div className="pp-pack__chips">{preview.companies.map((name) => <span key={name} className="pp-pill pp-pill--ended">{name}</span>)}</div>
          </>
        )}
        <div style={{ marginTop: 20 }}>
          {phase === "running" ? (
            <button type="button" className="pp-btn" onClick={() => { cancel.current = true; }}>Stop after this batch</button>
          ) : (
            <button type="button" className="pp-btn pp-btn--primary" onClick={run} disabled={!canWrite || nothing}>{phase === "done" ? "Import again" : "Import into my store"}</button>
          )}
        </div>
      </Section>

      {phase !== "choose" && (
        <Section title={phase === "running" ? stage : "Finished"}>
          {(progress.total > 0 || phase === "running") && <div className={`pp-progress${phase === "running" ? " is-active" : ""}`}><span style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} /></div>}
          <div className="pp-muted" style={{ fontSize: 13 }}>
            {progress.done} of {progress.total}
            {wantCatalog ? ` · ${totals.created} products created · ${totals.skipped} skipped · ${totals.failed} failed${totals.imagesMissing ? ` · ${totals.imagesMissing} pictures missing` : ""}${totals.pickLists ? ` · ${totals.pickLists} pick lists linked` : ""}` : ""}
            {wantB2b ? ` · ${totals.companies} B2B records created · ${totals.companiesSkipped} companies already there` : ""}
          </div>
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
          {phase === "done" && !error && <div role="status" className={`pp-msg ${totals.failed ? "pp-msg--err" : "pp-msg--ok"}`}>Done.</div>}
          {issues.length > 0 && <ul className="pp-errlist">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        </Section>
      )}
    </>
  );
}
