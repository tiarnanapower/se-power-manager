"use client";

import { useState } from "react";
import { Section } from "@/components/features/ui";
import { buildCommand, EDITIONS, type Edition } from "@/lib/utilities/catalyst-commands";

export function DeployCatalystView() {
  const [edition, setEdition] = useState<Edition>("b2b");
  const [collaborative, setCollaborative] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [projectName, setProjectName] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const current = EDITIONS.find((entry) => entry.id === edition)!;
  const result = buildCommand(edition, collaborative ? { repo, branch, projectName } : undefined);
  const touched = repo !== "" || branch !== "" || projectName !== "";

  const copy = async () => {
    if (!result.ok) return;

    try {
      await navigator.clipboard.writeText(result.command);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <>
      <Section title="Copy and paste into your terminal" hint="These commands create a Catalyst storefront and set it up for BigCommerce native hosting. They are not run by this app: paste them into a terminal on your own machine. You will be asked for your store details as it runs.">
        <div className="pp-tabs" role="tablist" aria-label="Storefront type">
          {EDITIONS.map((entry) => (
            <button key={entry.id} type="button" role="tab" id={`tab-${entry.id}`} aria-selected={edition === entry.id} aria-controls="deploy-panel" className="pp-tabs__tab" onClick={() => { setEdition(entry.id); setCopied(false); }}>{entry.label}</button>
          ))}
        </div>

        <div id="deploy-panel" role="tabpanel" aria-labelledby={`tab-${edition}`} className="pp-deploy">
          <p className="pp-section__hint">{current.blurb}</p>

          <label className="pp-deploy__toggle">
            <input type="checkbox" checked={collaborative} onChange={(event) => { setCollaborative(event.target.checked); setCopied(false); }} />
            <span>
              <strong>Push to a collaborative GitHub repo</strong>
              <span className="pp-muted">Also points the new project at a shared repo and pushes it on its own branch.</span>
            </span>
          </label>

          {collaborative && (
            <div className="pp-deploy__fields">
              <label className="pp-field"><span>GitHub repo</span><input className="pp-input" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/name or https://github.com/owner/name" spellCheck={false} autoComplete="off" /></label>
              <label className="pp-field"><span>Branch name</span><input className="pp-input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="my-demo" spellCheck={false} autoComplete="off" /></label>
              <label className="pp-field"><span>Project folder</span><input className="pp-input" value={projectName} onChange={(event) => setProjectName(event.target.value.toLowerCase())} placeholder="my-storefront" spellCheck={false} autoComplete="off" /><small className="pp-muted">The folder the project is created in. The git steps run inside it.</small></label>
            </div>
          )}

          <div className="pp-deploy__command">
            <pre aria-label={`${current.label} command`} className={result.ok ? "" : "is-placeholder"}>{result.ok ? result.command : result.preview}</pre>
            <button type="button" className="pp-btn pp-btn--primary" onClick={copy} disabled={!result.ok}>{copied ? "Copied" : "Copy command"}</button>
          </div>

          {!result.ok && touched && <ul className="pp-errlist">{result.errors.map((message) => <li key={message}>{message}</li>)}</ul>}
          {!result.ok && !touched && <p className="pp-muted" style={{ fontSize: 13 }}>Fill in the fields above to get the full command.</p>}
          {copyFailed && <div role="status" className="pp-msg pp-msg--err">Couldn&apos;t copy automatically. Select the command and copy it yourself.</div>}
        </div>
      </Section>

      <Section title="Before you run it" hint="What the command needs on your machine.">
        <ul className="pp-list">
          <li>Node.js 20 or newer, with a terminal that can run <code className="pp-code">corepack</code>.</li>
          <li>A BigCommerce store with a Catalyst channel, and an API account to hand when prompted. The command asks for them, so nothing secret goes into the command itself.</li>
          {collaborative && <li>An empty repo on GitHub that you can push to, with the branch name you chose not already taken.</li>}
        </ul>
      </Section>
    </>
  );
}
