"use client";

import { useState } from "react";
import { Section } from "@/components/features/ui";
import { buildCommand, checkCollaborative, EDITIONS, suggestProjectName, type Edition, type FieldState } from "@/lib/utilities/catalyst-commands";

// One input with its label. An empty one is marked "needed" in purple; red is kept for a value that was
// typed but can't be used.
function Field({ label, state, hint, children }: { label: string; state: FieldState; hint?: string; children: React.ReactNode }) {
  return (
    <label className={`pp-field pp-deploy__field${state.state === "empty" ? " is-needed" : ""}${state.state === "invalid" ? " is-invalid" : ""}`}>
      <span>{label}{state.state === "empty" && <em className="pp-deploy__needed">needed</em>}</span>
      {children}
      {state.state === "invalid" ? <small className="pp-deploy__problem">{state.message}</small> : hint ? <small className="pp-muted">{hint}</small> : null}
    </label>
  );
}

export function DeployCatalystView() {
  const [edition, setEdition] = useState<Edition>("b2b");
  const [collaborative, setCollaborative] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [typedProject, setTypedProject] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const current = EDITIONS.find((entry) => entry.id === edition)!;
  // The folder name follows the repo's name until the person types their own.
  const projectName = typedProject ?? suggestProjectName(repo);
  const fields = checkCollaborative({ repo, branch, projectName });
  const result = buildCommand(edition, collaborative ? { repo, branch, projectName } : undefined);
  const needed = ([["repo", "Destination GitHub repo"], ["branch", "Branch name"], ["projectName", "Project folder"]] as const).filter(([id]) => fields[id].state === "empty").map(([, label]) => label);

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
              <Field label="Destination GitHub repo" state={fields.repo}><input className="pp-input" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/name or https://github.com/owner/name" spellCheck={false} autoComplete="off" /></Field>
              <Field label="Branch name" state={fields.branch}><input className="pp-input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="my-demo" spellCheck={false} autoComplete="off" /></Field>
              <Field label="Project folder" state={fields.projectName} hint="Filled in from the repo name. The git steps run inside this folder."><input className="pp-input" value={projectName} onChange={(event) => setTypedProject(event.target.value.toLowerCase())} placeholder="my-storefront" spellCheck={false} autoComplete="off" /></Field>
            </div>
          )}

          <div className="pp-deploy__command">
            <pre aria-label={`${current.label} command`} className={result.ok ? "" : "is-placeholder"}>{result.ok ? result.command : result.preview}</pre>
            <button type="button" className="pp-btn pp-btn--primary" onClick={copy} disabled={!result.ok}>{copied ? "Copied" : "Copy command"}</button>
          </div>

          {!result.ok && <p className="pp-deploy__note">{needed.length > 0 ? `Still to fill in: ${needed.join(", ")}. The command above is an example until then.` : "Fix the highlighted field to get the command."}</p>}
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
