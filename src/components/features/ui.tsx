import { Message } from "@bigcommerce/big-design";
import { NAV_ITEMS } from "@/components/shell/nav-items";

export function FeaturePage({ itemId, children }: { itemId: string; children: React.ReactNode }) {
  const item = NAV_ITEMS.find((candidate) => candidate.id === itemId);

  return (
    <div className="pp-feature">
      <p className="pp-feature__lead">{item?.description}</p>
      {children}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="pp-card pp-section">
      <h2>{title}</h2>
      {hint ? <p className="pp-section__hint">{hint}</p> : <div style={{ height: 12 }} />}
      {children}
    </section>
  );
}

export function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pp-kv">
      <div className="pp-kv__k">{label}</div>
      <div className="pp-kv__v">{children}</div>
    </div>
  );
}

export function StatusPill({ ok, yes = "Configured", no = "Not configured" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className="pp-pill" style={{ background: ok ? "var(--pp-live-bg)" : "var(--pp-exhausted-bg)", color: ok ? "var(--pp-live-text)" : "var(--pp-exhausted-text)" }}>
      {ok ? yes : no}
    </span>
  );
}

// A feature whose page exists but whose behaviour is the next phase.
export function Planned({ items }: { items: string[] }) {
  return (
    <Section title="Planned" hint="This page is scaffolded. These are the capabilities it will have.">
      <span className="pp-pill pp-pill--soon">Coming soon</span>
      <ul className="pp-list" style={{ marginTop: 12 }}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </Section>
  );
}

export function LoadError({ header, text }: { header: string; text: string }) {
  return <Message type="error" header={header} messages={[{ text }]} />;
}

export function NotConfigured({ what, vars }: { what: string; vars: string[] }) {
  return (
    <Section title={`${what} isn't configured`} hint="Add these to the server environment, then reload.">
      <ul className="pp-list">
        {vars.map((name) => <li key={name}><code>{name}</code></li>)}
      </ul>
    </Section>
  );
}
