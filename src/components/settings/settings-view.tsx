"use client";

import { useState } from "react";
import { testBigGearConnection, testConnection } from "@/app/store/[storeHash]/settings/actions";

interface Props {
  storeHash: string | undefined;
  connection: { modeLabel: string; store: string; canTest: boolean };
  bigGear: { configured: boolean; storeLabel: string; repoLabel: string; githubToken: boolean; canTest: boolean };
  ai: { configured: boolean; model: string };
  imageStorage: boolean;
}

// What the app asks for at install. Phase notes say when each is first used.
const SCOPES = [
  ["Products", "modify", "Import, edit and clear products and categories"],
  ["Content", "modify", "Upload Stencil themes (Big Gear pull)"],
  ["Channel settings", "modify", "Create Stencil and Catalyst channels"],
  ["Information & Settings", "read-only", "Store name and details"],
  ["B2B Edition", "modify", "Copy B2B data from Big Gear (only needed for the B2B pull)"],
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="pp-card pp-section">
      <h2>{title}</h2>
      <p className="pp-section__hint">{description}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pp-kv">
      <div className="pp-kv__k">{label}</div>
      <div className="pp-kv__v">{children}</div>
    </div>
  );
}

function Pill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className="pp-pill" style={{ background: ok ? "var(--pp-live-bg)" : "var(--pp-exhausted-bg)", color: ok ? "var(--pp-live-text)" : "var(--pp-exhausted-text)" }}>
      {ok ? yes : no}
    </span>
  );
}

function TestButton({ label, disabled, run }: { label: string; disabled: boolean; run: () => Promise<{ success: boolean; message: string }> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | undefined>();

  const onClick = async () => {
    setBusy(true);
    setResult(undefined);

    try {
      setResult(await run());
    } catch {
      setResult({ success: false, message: "The check couldn't run. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="pp-btn" onClick={onClick} disabled={busy || disabled}>{busy ? "Checking…" : label}</button>
      {result && <span role="status" style={{ marginLeft: 12, fontSize: 13, color: result.success ? "var(--pp-ok)" : "var(--pp-invalid)" }}>{result.message}</span>}
    </>
  );
}

export function SettingsView({ storeHash, connection, bigGear, ai, imageStorage }: Props) {
  return (
    <div style={{ maxWidth: 760 }}>
      <Section title="Your store" description="The store this app is installed on. Imports and clears write here.">
        <Field label="Mode">{connection.modeLabel}</Field>
        <Field label="Store">{connection.store}</Field>
        <Field label="Connection check"><TestButton label="Test connection" disabled={!connection.canTest} run={() => testConnection(storeHash)} /></Field>
        <Field label="Required API scopes">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {SCOPES.map(([name, level, why]) => (
              <li key={name}><strong>{name}</strong> ({level}): <span className="pp-muted">{why}</span></li>
            ))}
          </ul>
        </Field>
      </Section>

      <Section title="Big Gear" description="The shared demo store everyone pulls products, the Stencil theme and the B2B channel from. Read-only.">
        <Field label="Store"><Pill ok={bigGear.configured} yes={`Configured · ${bigGear.storeLabel}`} no="Not configured" /></Field>
        <Field label="B2B Catalyst repo">{bigGear.repoLabel}</Field>
        <Field label="GitHub token"><Pill ok={bigGear.githubToken} yes="Set" no="Not set (public repos only)" /></Field>
        <Field label="Connection check"><TestButton label="Test Big Gear" disabled={!bigGear.canTest} run={() => testBigGearConnection(storeHash)} /></Field>
      </Section>

      <Section title="Image storage" description="Where pack images are copied (Vercel Blob) so they survive the products being deleted. Without it, a backup before a clear can't restore pictures.">
        <Field label="Status"><Pill ok={imageStorage} yes="Configured" no="Not configured (set BLOB_READ_WRITE_TOKEN)" /></Field>
      </Section>

      <Section title="AI" description="Used by the Import and Enrich tools. The key stays on the server.">
        <Field label="Status"><Pill ok={ai.configured} yes="Gateway key configured" no="Not configured" /></Field>
        <Field label="Model">{ai.model}</Field>
      </Section>
    </div>
  );
}
