"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { scanHealthAction } from "@/app/store/[storeHash]/store-health/actions";
import { productAdminUrl } from "@/lib/enrich/client-types";
import type { CheckResult, Severity } from "@/lib/health/checks";
import type { ScanResult } from "@/lib/health/scan";
import { getAppUrl } from "@/lib/routing/app-url";

const SEVERITY_LABEL: Record<Severity, string> = { issue: "Needs fixing", warning: "Worth a look", info: "For information" };

function scoreTone(score: number): string {
  return score >= 90 ? "good" : score >= 70 ? "ok" : "bad";
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className={`pp-health__ring pp-health__ring--${scoreTone(score)}`} style={{ ["--score" as string]: `${score}%` }} role="img" aria-label={`Health score ${score} percent`}>
      <div className="pp-health__ring-inner">
        <strong>{score}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

function CheckCard({ check, storeHash }: { check: CheckResult; storeHash: string | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`pp-card pp-health__check pp-health__check--${check.severity}`}>
      <div className="pp-health__check-head">
        <div>
          <h3>{check.label}</h3>
          <p className="pp-muted">{check.description}</p>
        </div>
        <span className="pp-health__count">{check.count}</span>
      </div>
      <div className="pp-row">
        <button type="button" className="pp-btn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Hide products" : `Show ${Math.min(check.count, check.samples.length)} product${check.samples.length === 1 ? "" : "s"}`}</button>
        {check.fix && <Link className="pp-btn pp-btn--primary" href={getAppUrl(storeHash, `/${check.fix.path}`)}>{check.fix.label}</Link>}
      </div>
      {open && (
        <ul className="pp-health__list">
          {check.samples.map((product) => (
            <li key={product.id}>
              {storeHash ? <a href={productAdminUrl(storeHash, product.id)} target="_blank" rel="noreferrer">{product.name}</a> : product.name}
              <span className="pp-muted"> #{product.id}</span>
            </li>
          ))}
          {check.count > check.samples.length && <li className="pp-muted">…and {check.count - check.samples.length} more</li>}
        </ul>
      )}
    </section>
  );
}

export function HealthView({ storeHash, canScan }: { storeHash: string | undefined; canScan: boolean }) {
  const [report, setReport] = useState<ScanResult>();
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const started = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(undefined);

    try {
      const result = await scanHealthAction(storeHash);

      if (result.ok) setReport(result.report);
      else setError(result.message);
    } catch {
      setError("Lost contact with the server. Try again.");
    } finally {
      setScanning(false);
    }
  }, [storeHash]);

  // Scan once when the page opens, so the dashboard isn't empty.
  useEffect(() => {
    if (started.current || !canScan) return;

    started.current = true;
    void scan();
  }, [canScan, scan]);

  if (!canScan) return <div className="pp-empty">Demo data mode has no store to scan. Use DATA_MODE=STATIC or install the app.</div>;

  const found = report?.checks.filter((check) => check.count > 0) ?? [];
  const clear = report?.checks.filter((check) => check.count === 0) ?? [];
  const bySeverity = (severity: Severity) => found.filter((check) => check.severity === severity);

  return (
    <>
      <section className="pp-card pp-section pp-health__summary">
        {report ? <ScoreRing score={report.score} /> : <div className="pp-health__ring pp-health__ring--wait"><div className="pp-health__ring-inner"><span>{scanning ? "Scanning…" : "—"}</span></div></div>}
        <div className="pp-health__summary-text">
          <h2>{report ? (report.score >= 90 ? "Your catalog is in good shape" : report.score >= 70 ? "A few things need attention" : "Your catalog needs work") : "Checking your catalog"}</h2>
          <p className="pp-section__hint">
            {report ? `${report.total - Math.round((report.score / 100) * report.total)} of ${report.total} products have an issue or warning. Hidden products, missing brands and missing SEO text are listed for information and don't lower the score.` : "Reading every product in your store. Nothing is changed."}
          </p>
          {report?.truncated && <p className="pp-note">Only the first {report.total} of {report.storeTotal} products were scanned.</p>}
          <div className="pp-row">
            <button type="button" className="pp-btn pp-btn--primary" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan again"}</button>
            {report && <span className="pp-muted" style={{ alignSelf: "center", fontSize: 13 }}>Last scan {new Date(report.scannedAt).toLocaleTimeString()}</span>}
          </div>
          {scanning && <div className="pp-progress is-active"><span style={{ width: "100%" }} /></div>}
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
        </div>
      </section>

      {report && (["issue", "warning", "info"] as Severity[]).map((severity) => bySeverity(severity).length > 0 && (
        <div key={severity} className="pp-health__group">
          <h2 className="pp-health__group-title">{SEVERITY_LABEL[severity]}</h2>
          <div className="pp-health__grid">
            {bySeverity(severity).map((check) => <CheckCard key={check.id} check={check} storeHash={storeHash} />)}
          </div>
        </div>
      ))}

      {report && clear.length > 0 && (
        <section className="pp-card pp-section">
          <h2>All clear</h2>
          <p className="pp-section__hint">No products were flagged for these.</p>
          <div className="pp-health__chips">{clear.map((check) => <span key={check.id} className="pp-pill pp-pill--live">✓ {check.label}</span>)}</div>
        </section>
      )}
    </>
  );
}
