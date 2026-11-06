"use client";

import { useState } from "react";
import { testConnection } from "@/app/store/[storeHash]/settings/actions";
import { type CalendarViewKey } from "@/lib/preferences";
import { usePreferences } from "@/lib/use-preferences";

interface Props {
  storeHash: string | undefined;
  connection: { modeLabel: string; store: string; canTest: boolean };
  copilot: { configured: boolean; model: string };
}

const SCOPES = [
  ["Marketing", "modify", "Read and schedule promotions and coupon codes"],
  ["Products", "read-only", "Show category, brand and product names"],
  ["Customers", "modify", "Customer groups, plus segments: list, create and add customers (Enterprise)"],
  ["Orders", "read-only", "Recommendations from order history"],
  ["Information & Settings", "read-only", "Your store's time zone, so dates match the control panel"],
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="pp-card" style={{ padding: 20, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
      <p className="pp-muted" style={{ margin: "2px 0 14px", fontSize: 13 }}>{description}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0", borderTop: "1px solid var(--pp-border)", fontSize: 14 }}>
      <div style={{ width: 180, fontWeight: 600 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export function SettingsView({ storeHash, connection, copilot }: Props) {
  const [preferences, setPreferences] = usePreferences();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | undefined>();

  const runTest = async () => {
    setTesting(true);
    setResult(undefined);

    try {
      setResult(await testConnection(storeHash));
    } catch {
      setResult({ success: false, message: "The check couldn't run. Try again." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <Section title="Store connection" description="Where promotions are read from and written to.">
        <Field label="Mode">{connection.modeLabel}</Field>
        <Field label="Store">{connection.store}</Field>
        <Field label="Connection check">
          <button type="button" className="pp-btn" onClick={runTest} disabled={testing || !connection.canTest}>{testing ? "Checking…" : "Test connection"}</button>
          {result && (
            <span role="status" style={{ marginLeft: 12, fontSize: 13, color: result.success ? "var(--pp-ok)" : "var(--pp-invalid)" }}>{result.message}</span>
          )}
        </Field>
        <Field label="Required API scopes">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {SCOPES.map(([name, level, why]) => (
              <li key={name}><strong>{name}</strong> ({level}): <span className="pp-muted">{why}</span></li>
            ))}
          </ul>
        </Field>
      </Section>

      <Section title="AI copilot" description="Chat that drafts, schedules and edits promotions. Changes are shown as a draft first and need your confirmation.">
        <Field label="Status">
          <span className="pp-pill" style={{ background: copilot.configured ? "var(--pp-live-bg)" : "var(--pp-exhausted-bg)", color: copilot.configured ? "var(--pp-live-text)" : "var(--pp-exhausted-text)" }}>
            {copilot.configured ? "Gateway key configured" : "Not configured"}
          </span>
        </Field>
        <Field label="Model">{copilot.model}</Field>
      </Section>

      <Section title="Calendar preferences" description="Saved in this browser only.">
        <Field label="Default view">
          <select className="pp-input" aria-label="Default view" value={preferences.defaultView} onChange={(event) => setPreferences({ ...preferences, defaultView: event.target.value as CalendarViewKey })}>
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="quarter">Quarter</option>
            <option value="timeline">Timeline</option>
          </select>
        </Field>
        <Field label="Week starts on">
          <select className="pp-input" aria-label="Week starts on" value={preferences.weekStartsOn} onChange={(event) => setPreferences({ ...preferences, weekStartsOn: event.target.value === "1" ? 1 : 0 })}>
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
          </select>
        </Field>
        <Field label="Always-on strip">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={preferences.showAlwaysOn} onChange={(event) => setPreferences({ ...preferences, showAlwaysOn: event.target.checked })} />
            Show promotions with no end date above the calendar
          </label>
        </Field>
        <Field label="Time zone">UTC. Dates across the app are shown in UTC.</Field>
      </Section>
    </div>
  );
}
