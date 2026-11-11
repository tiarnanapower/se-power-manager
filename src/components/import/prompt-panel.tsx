"use client";

import { useState } from "react";
import { buildImportPrompt, parsePastedProducts } from "@/lib/import/paste";
import type { ScrapedProduct } from "@/lib/import/scrape";

interface Props {
  urls: string[];
  count: number;
  // Shown above the steps when the panel was opened because a scrape failed.
  reason?: string;
  onLoad: (products: ScrapedProduct[], note: string) => void;
  onClose: () => void;
}

// Copy a prompt into Claude or ChatGPT, then paste its JSON answer back.
export function PromptPanel({ urls, count, reason, onLoad, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const prompt = buildImportPrompt(urls, count);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically. Select the prompt text and copy it.");
    }
  };

  const load = () => {
    setError("");

    try {
      const { products, skipped } = parsePastedProducts(pasted, urls[0]);

      onLoad(products, `Loaded ${products.length} product${products.length === 1 ? "" : "s"} from the AI answer${skipped ? ` (${skipped} skipped: no name or duplicate)` : ""}. Review them below before anything is written.`);
      setPasted("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't read that.");
    }
  };

  return (
    <section className="pp-card pp-section pp-promptpanel">
      <div className="pp-promptpanel__head">
        <div>
          <h2>Use an AI prompt instead</h2>
          <p className="pp-section__hint">{reason ?? "Ask Claude or ChatGPT to read the site, then paste its answer here. It works on sites that block automated scraping."}</p>
        </div>
        <button type="button" className="pp-btn" onClick={onClose}>Close</button>
      </div>

      <ol className="pp-promptpanel__steps">
        <li>
          <div className="pp-promptpanel__step-head">
            <strong>Copy this prompt into Claude or ChatGPT</strong>
            <button type="button" className="pp-btn pp-btn--primary" onClick={copy}>{copied ? "Copied" : "Copy prompt"}</button>
          </div>
          {urls.length === 0 && <p className="pp-note">Add the page addresses above first and the prompt will include them.</p>}
          <pre className="pp-promptpanel__prompt">{prompt}</pre>
        </li>
        <li>
          <div className="pp-promptpanel__step-head"><strong>Paste its answer here</strong></div>
          <textarea
            className="pp-input"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 130, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
            value={pasted}
            onChange={(event) => { setPasted(event.target.value); setError(""); }}
            placeholder={'[{"name":"Trail Runner","price":89.99,"images":["https://…"]}]'}
          />
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
          <div className="pp-row" style={{ marginTop: 12 }}>
            <button type="button" className="pp-btn pp-btn--primary" onClick={load} disabled={!pasted.trim()}>Load products for review</button>
          </div>
        </li>
      </ol>
    </section>
  );
}
