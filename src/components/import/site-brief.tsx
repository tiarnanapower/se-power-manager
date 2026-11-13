"use client";

import { useEffect, useRef, useState } from "react";
import { customerGroupsAction, generateBriefAction } from "@/app/store/[storeHash]/catalog/import/brief-actions";
import { briefToText, type Brief, type BriefSection } from "@/lib/brief/generate";
import { buildRunPrompt } from "@/lib/brief/run-prompt";
import type { Audience } from "@/lib/brief/template";

async function copy(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);

    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button type="button" className="pp-btn pp-copy" disabled={!value} onClick={async () => { setState((await copy(value)) ? "copied" : "failed"); setTimeout(() => setState("idle"), 1600); }}>
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}

function Row({ label, value, limit }: { label: string; value: string; limit?: number }) {
  return (
    <div className="pp-copyrow">
      <div className="pp-copyrow__label">{label}{limit ? <span className={value.length > limit ? "pp-copyrow__over" : "pp-muted"}> {value.length}/{limit}</span> : null}</div>
      <div className="pp-copyrow__value">{value || <span className="pp-muted">Not written. Try again.</span>}</div>
      <CopyButton value={value} />
    </div>
  );
}

function Section({ section }: { section: BriefSection }) {
  return (
    <div className="pp-card pp-section">
      <h2>{section.title}</h2>
      <p className="pp-section__hint">In Makeswift: <strong>{section.element}</strong>{section.note ? `. ${section.note}` : ""}</p>
      {section.targeted && (
        <div className="pp-pack__chips" style={{ marginBottom: 12 }}>
          <span className="pp-muted" style={{ fontSize: 13 }}>Targeted customer groups:</span>
          {section.groups.length ? section.groups.map((name) => <span key={name} className="pp-pill pp-pill--ended">{name}</span>) : <span className="pp-muted" style={{ fontSize: 13 }}>choose them on the slot in Makeswift</span>}
        </div>
      )}
      {section.fields.map((field) => <Row key={field.key} label={field.label} value={field.value} limit={field.max} />)}
      {section.images.map((image) => (
        <div key={image.key} style={{ marginTop: 14 }}>
          <div className="pp-copyrow__label">Picture: {image.label} <span className="pp-pill pp-pill--ended">{image.size} px</span>{image.textOver ? <span className="pp-pill pp-pill--ended">text sits on top</span> : null}</div>
          <Row label="Image prompt" value={image.prompt} />
          <Row label="Alt text" value={image.alt} />
        </div>
      ))}
      {section.videos.map((video) => (
        <div key={video.key} style={{ marginTop: 14 }}>
          <div className="pp-copyrow__label">Video: {video.label} <span className="pp-pill pp-pill--ended">{video.length}</span></div>
          <Row label="Shot list" value={video.shots.map((shot, index) => `${index + 1}. ${shot}`).join("\n")} />
          <Row label="Stock footage search" value={video.keywords.join(", ")} />
        </div>
      ))}
    </div>
  );
}

function BrandKit({ brief }: { brief: Brief }) {
  const { brand } = brief;
  const label = (role?: string) => (role ? role[0].toUpperCase() + role.slice(1) : "Other");

  return (
    <div className="pp-card pp-section">
      <h2>Brand kit</h2>
      <p className="pp-section__hint">Read from the customer&apos;s site. Check the colours and fonts against the site, because a stylesheet doesn&apos;t always say which colour is the brand&apos;s. In Makeswift these go in the Design tab.</p>
      <div className="pp-swatches">
        {brand.colours.map((colour) => (
          <div key={colour.hex} className="pp-swatch">
            <span className="pp-swatch__chip" style={{ background: colour.hex }} />
            <div><strong>{label(colour.role)}</strong><div className="pp-muted" style={{ fontSize: 13 }}>{colour.hex}</div></div>
            <CopyButton value={colour.hex} />
          </div>
        ))}
      </div>
      {brand.fonts.heading && <Row label="Heading font (Headline style)" value={brand.fonts.heading} />}
      {brand.fonts.body && <Row label="Body font (Body style)" value={brand.fonts.body} />}
      {brand.logo && <Row label="Logo address" value={brand.logo} />}
      {brand.contact.phone && <Row label="Phone" value={brand.contact.phone} />}
      {brand.contact.email && <Row label="Email" value={brand.contact.email} />}
      {brand.contact.address && <Row label="Address" value={brand.contact.address} />}
      {brand.social.length > 0 && <Row label="Social links" value={brand.social.map((entry) => `${entry.name}: ${entry.url}`).join("\n")} />}
      {(brief.voice.tagline || brief.voice.tone) && <Row label="Voice" value={[brief.voice.tagline && `Tagline: ${brief.voice.tagline}`, brief.voice.tone && `Tone: ${brief.voice.tone}`, brief.voice.industry && `Industry: ${brief.voice.industry}`, brief.voice.audience && `Audience: ${brief.voice.audience}`].filter(Boolean).join("\n")} />}
      <p className="pp-muted" style={{ fontSize: 13, marginTop: 12 }}>The store&apos;s navigation, footer contact details and Best Sellers products come from the store itself. Import the products first, and set the address and phone in the store&apos;s settings.</p>
    </div>
  );
}

function RunInClaude({ brief }: { brief: Brief }) {
  const [siteUrl, setSiteUrl] = useState("");
  const prompt = buildRunPrompt(brief, siteUrl.trim() || undefined);

  return (
    <div className="pp-card pp-section">
      <h2>Run in Claude</h2>
      <p className="pp-section__hint">Have Claude fill in the text and colours for you. It works in your own Chrome, so this needs the Claude in Chrome extension installed and signed in to your Claude account, and you signed in to Makeswift in that Chrome.</p>
      <ol className="pp-steps">
        <li>In Makeswift, <strong>duplicate the template site</strong> so you have your own copy. The sections are shared across a site, so never run this on the original.</li>
        <li>Open your copy and paste its address below.</li>
        <li>Open Claude (the Claude in Chrome side panel, or Claude with Chrome connected), copy the instructions and paste them in.</li>
        <li>Watch it work, check the result, and <strong>publish it yourself</strong>. The instructions tell Claude never to publish.</li>
        <li>Make the pictures and videos from the briefs above, and upload them.</li>
      </ol>
      <label className="pp-field">Your copy of the template (address)
        <input className="pp-input" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://app.makeswift.com/…" style={{ maxWidth: "100%" }} />
      </label>
      <textarea readOnly className="pp-input pp-prompt" value={prompt} aria-label="Instructions for Claude" />
      <div style={{ marginTop: 10 }}><CopyButton value={prompt} label="Copy the instructions" /></div>
    </div>
  );
}

const STAGES = ["Loading the site", "Reading its colours and fonts", "Writing the copy and the picture briefs", "Still working. Big sites take longer"];

export function SiteBrief({ storeHash, aiConfigured, canWrite }: { storeHash: string | undefined; aiConfigured: boolean; canWrite: boolean }) {
  const [url, setUrl] = useState("");
  // B2C is on by default, and at least one audience always stays on.
  const [audiences, setAudiences] = useState<Set<Audience>>(new Set(["b2c"]));
  const [available, setAvailable] = useState<string[]>();
  const [chosen, setChosen] = useState<Record<Audience, Set<string>>>({ b2c: new Set(), b2b: new Set() });
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [brief, setBrief] = useState<Brief>();
  const [error, setError] = useState<string>();
  const started = useRef(0);

  useEffect(() => {
    if (!canWrite) return;

    let live = true;

    customerGroupsAction(storeHash).then((result) => { if (live && result.ok) setAvailable(result.groups); }, () => undefined);

    return () => { live = false; };
  }, [storeHash, canWrite]);

  useEffect(() => {
    if (!busy) return;

    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 500);

    return () => clearInterval(timer);
  }, [busy]);

  const toggleAudience = (audience: Audience) => setAudiences((current) => {
    const next = new Set(current);

    if (next.has(audience)) {
      if (next.size > 1) next.delete(audience);
    } else {
      next.add(audience);
    }

    return next;
  });

  const toggleGroup = (audience: Audience, name: string) => setChosen((current) => {
    const next = new Set(current[audience]);

    if (next.has(name)) next.delete(name);
    else next.add(name);

    return { ...current, [audience]: next };
  });

  const generate = async () => {
    setBusy(true);
    setError(undefined);
    setElapsed(0);
    started.current = Date.now();

    try {
      const picked = [...audiences];
      const result = await generateBriefAction(storeHash, { url: url.trim(), audiences: picked, groups: { b2c: picked.includes("b2c") ? [...chosen.b2c] : [], b2b: picked.includes("b2b") ? [...chosen.b2b] : [] } });

      if (result.ok) setBrief(result.brief);
      else setError(result.message);
    } catch {
      setError("Lost contact with the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const stage = STAGES[elapsed < 4 ? 0 : elapsed < 10 ? 1 : elapsed < 60 ? 2 : 3];

  return (
    <>
      <section className="pp-card pp-section">
        <h2>Site brief for Makeswift</h2>
        <p className="pp-section__hint">Paste the customer&apos;s home page. You get their colours and fonts, the text for every section of the template, a written brief for each picture and video, and the B2C and B2B customer-group slots. Nothing is changed in your store or in Makeswift.</p>
        {!aiConfigured && <div className="pp-warn">The AI gateway isn&apos;t configured. Add <code className="pp-code">PORTKEY_API_KEY</code> to the server environment.</div>}
        <label className="pp-field">Customer&apos;s website
          <input className="pp-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.example.com" disabled={busy} style={{ maxWidth: "100%" }} />
        </label>
        <fieldset className="pp-audiences" disabled={busy}>
          <legend>Who is the demo for?</legend>
          {(["b2c", "b2b"] as const).map((audience) => (
            <div key={audience} className="pp-audience">
              <label><input type="checkbox" checked={audiences.has(audience)} onChange={() => toggleAudience(audience)} /> <strong>{audience === "b2c" ? "B2C" : "B2B"}</strong> <span className="pp-muted">{audience === "b2c" ? "consumers and members" : "trade and business buyers"}</span></label>
              {audiences.has(audience) && (
                <div className="pp-pack__chips" style={{ marginTop: 8 }}>
                  {available === undefined ? <span className="pp-muted" style={{ fontSize: 13 }}>Customer groups can be chosen on the slot in Makeswift.</span> : available.length === 0 ? <span className="pp-muted" style={{ fontSize: 13 }}>This store has no customer groups yet.</span> : available.map((name) => (
                    <label key={name} className="pp-chipcheck"><input type="checkbox" checked={chosen[audience].has(name)} onChange={() => toggleGroup(audience, name)} /> {name}</label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </fieldset>
        <div style={{ marginTop: 16 }}>
          <button type="button" className="pp-btn pp-btn--primary" onClick={generate} disabled={busy || !aiConfigured || !url.trim()}>{busy ? "Working…" : brief ? "Make a new brief" : "Make the brief"}</button>
        </div>
        {busy && (
          <>
            <div className="pp-progress is-active" aria-hidden="true"><span style={{ width: `${Math.min(92, 8 + elapsed * 2)}%` }} /></div>
            <div className="pp-muted" style={{ fontSize: 13 }}>{stage} · {elapsed}s. This usually takes up to a minute.</div>
          </>
        )}
        {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
      </section>

      {brief && (
        <>
          {brief.warnings.map((warning) => <div key={warning} className="pp-warn">{warning}</div>)}
          <div className="pp-section__top" style={{ margin: "4px 0 12px" }}>
            <span className="pp-muted">Brief for <strong>{brief.brand.siteName || brief.url}</strong></span>
            <CopyButton value={briefToText(brief)} label="Copy everything as text" />
          </div>
          <BrandKit brief={brief} />
          {brief.sections.map((section) => <Section key={section.id} section={section} />)}
          <RunInClaude brief={brief} />
        </>
      )}
    </>
  );
}
