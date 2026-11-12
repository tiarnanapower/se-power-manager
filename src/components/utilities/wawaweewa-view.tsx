"use client";

import { useState } from "react";
import { finishWawaweewaPickListsAction, importWawaweewaB2bAction, importWawaweewaBatchAction, planWawaweewaAction, planWawaweewaB2bAction, testWawaweewaB2bAction } from "@/app/store/[storeHash]/utilities/wawaweewa/actions";
import { Section } from "@/components/features/ui";
import { JobProgress } from "@/components/jobs/job-progress";
import { SampleImage } from "@/components/samples/sample-image";
import { WawaweewaSpinner } from "@/components/utilities/wawaweewa-spinner";
import { dismissJob, finishJob, isCancelled, patchJob, requestCancel, startJob, useJob, type Job } from "@/lib/jobs/job-store";
import type { B2bProbe } from "@/lib/wawaweewa/config";
import type { SourcePreview } from "@/lib/wawaweewa/source";

const JOB = "wawaweewa";
const path = (storeHash: string | undefined) => (storeHash ? `/store/${storeHash}/utilities/wawaweewa` : "/utilities/wawaweewa");

const money = (value: number | null) => (value === null ? "" : value.toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function WawaweewaView({ storeHash, preview, sourceLabel, canWrite, tokenHint }: { storeHash: string | undefined; preview: SourcePreview; sourceLabel: string; canWrite: boolean; tokenHint?: string }) {
  const [wantCatalog, setWantCatalog] = useState(preview.productTotal > 0);
  const [wantB2b, setWantB2b] = useState((preview.companyTotal ?? 0) > 0);
  // The run lives in the job store, so leaving this page and coming back shows where it got to.
  const job = useJob(JOB);
  const [probes, setProbes] = useState<B2bProbe[]>();
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string>();
  const phase = job?.phase ?? "choose";

  const nothing = (!wantCatalog || preview.productTotal === 0) && (!wantB2b || !preview.companyTotal);

  const probe = async () => {
    setProbing(true);
    setProbeError(undefined);

    const result = await testWawaweewaB2bAction(storeHash).catch(() => undefined);

    setProbing(false);

    if (!result?.ok) setProbeError(result ? result.message : "Lost contact with the server.");
    else setProbes(result.probes);
  };

  const run = async () => {
    startJob(JOB, { title: "Wawaweewa import", href: path(storeHash), stage: "Starting" });

    const sum = { created: 0, skipped: 0, failed: 0, imagesMissing: 0, pickLists: 0, companies: 0, companiesSkipped: 0 };
    const notes: string[] = [];
    const summary = () => [
      wantCatalog ? `${sum.created} products created · ${sum.skipped} skipped · ${sum.failed} failed${sum.imagesMissing ? ` · ${sum.imagesMissing} pictures missing` : ""}${sum.pickLists ? ` · ${sum.pickLists} pick lists linked` : ""}` : "",
      wantB2b ? `${sum.companies} B2B records created · ${sum.companiesSkipped} companies already there` : "",
    ].filter(Boolean).join(" · ");
    const show = (more: Partial<Job> = {}) => patchJob(JOB, { summary: summary(), issues: notes.slice(0, 80), ...more });
    const stopped = () => {
      if (!isCancelled(JOB)) return false;

      finishJob(JOB, { summary: summary(), issues: notes.slice(0, 80), error: "Stopped. Anything already created stays in your store." });

      return true;
    };

    try {
      if (wantCatalog) {
        show({ stage: "Reading the source catalog", done: 0, total: preview.productTotal });

        const plan = await planWawaweewaAction(storeHash);

        if (!plan.ok) throw new Error(plan.message);

        const { ids, refs } = plan.plan;

        show({ stage: "Importing products", done: 0, total: ids.length });

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
          show({ done: Math.min(ids.length, at + 10) });
        }

        // Pick lists point at other products, so they wait until every product exists.
        show({ stage: "Linking pick lists" });

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
        show({ stage: "Reading the source B2B companies", done: 0, total: 0 });

        const plan = await planWawaweewaB2bAction(storeHash);

        if (!plan.ok) throw new Error(plan.message);

        notes.push(...plan.warnings);

        const { companies } = plan;

        show({ stage: "Importing B2B companies and users", done: 0, total: companies.length });

        for (let at = 0; at < companies.length; at += 3) {
          if (stopped()) return;

          const result = await importWawaweewaB2bAction(storeHash, { companies: companies.slice(at, at + 3) });

          if (!result.ok) throw new Error(result.message);

          sum.companies += result.result.created;
          sum.companiesSkipped += result.result.skipped;
          notes.push(...result.result.warnings);
          show({ done: Math.min(companies.length, at + 3) });
        }
      }

      finishJob(JOB, { summary: summary(), issues: notes.slice(0, 80) });
    } catch (failure) {
      finishJob(JOB, { summary: summary(), issues: notes.slice(0, 80), error: failure instanceof Error ? failure.message : "Lost contact with the server. Anything already created stays in your store." });
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
        {tokenHint && <p className="pp-muted" style={{ marginTop: 8, fontSize: 13 }}>{tokenHint} Compare it with the token you created.</p>}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="pp-btn" onClick={probe} disabled={probing}>{probing ? "Testing…" : "Test B2B connection"}</button>
        </div>
        {probeError && <div className="pp-msg pp-msg--err">{probeError}</div>}
        {probes && (
          <ul className="pp-errlist" style={{ marginTop: 10 }}>
            {probes.map((entry) => <li key={entry.label}><strong>{entry.label}:</strong> {entry.status}{entry.contentType ? ` (${entry.contentType})` : ""} {entry.body}</li>)}
          </ul>
        )}
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
            <button type="button" className="pp-btn" disabled={job?.cancelRequested} onClick={() => requestCancel(JOB)}>{job?.cancelRequested ? "Stopping…" : "Stop after this batch"}</button>
          ) : (
            <button type="button" className="pp-btn pp-btn--primary" onClick={() => { dismissJob(JOB); void run(); }} disabled={!canWrite || nothing}>{phase === "done" ? "Import again" : "Import into my store"}</button>
          )}
        </div>
      </Section>

      {job && (
        <Section title={job.phase === "running" ? job.stage : "Finished"}>
          {job.phase === "running" && <WawaweewaSpinner small label="Importing" />}
          <JobProgress job={job} />
          {job.error && <div role="status" className="pp-msg pp-msg--err">{job.error}</div>}
          {job.phase === "done" && !job.error && <div role="status" className="pp-msg pp-msg--ok">Done.</div>}
          {job.issues.length > 0 && <ul className="pp-errlist">{job.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
        </Section>
      )}
    </>
  );
}
