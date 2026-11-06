"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { applyCopilotDraft, setPromotionEnabled } from "@/app/store/[storeHash]/copilot/actions";
import { type DraftView, DraftCard } from "@/components/shell/draft-card";
import { ChatIcon, CloseIcon } from "@/components/shell/icons";
import { MessageText } from "@/components/shell/message-text";
import { showErrorAlert, showSuccessAlert } from "@/components/ui/action-alerts";
import type { Draft } from "@/lib/copilot/draft-spec";

interface ChatItem {
  id: number;
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  drafts?: Array<DraftView & { draft: Draft }>;
  choices?: { question: string; multiple: boolean; options: Array<{ label: string; prompt: string }>; used?: boolean };
}

const SUGGESTIONS = [
  "What's running next week?",
  "Which days in the next 90 days have no site-wide offer?",
  "Draft 15% off everything for Black Friday weekend",
  "Do any of my promotions overlap?",
];

const MAX_HISTORY = 16;

// What the model gets as memory of earlier turns: the text, plus a compact note of any drafts and their fate.
function toHistory(items: ChatItem[]) {
  return items.slice(-MAX_HISTORY).map((item) => ({
    role: item.role,
    content:
      item.role === "assistant" && item.drafts?.length
        ? `${item.text}\n\n${item.drafts.map((d) => `[Draft "${d.preview.title}" is ${d.status}${d.promotionId ? `, promotion id ${d.promotionId}` : ""}: ${JSON.stringify(d.draft)}]`).join("\n")}`
        : item.text,
  }));
}

interface DockProps {
  configured: boolean;
  seed: { text: string; send: boolean; nonce: number } | undefined;
  onClose(): void;
}

export function CopilotDock({ configured, seed, onClose }: DockProps) {
  const router = useRouter();
  const params = useParams<{ storeHash?: string }>();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState(seed && !seed.send ? seed.text : "");
  const [working, setWorking] = useState(false);
  const [busyDraft, setBusyDraft] = useState(false);
  const idRef = useRef(1);
  const itemsRef = useRef<ChatItem[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const handledSeed = useRef<number | undefined>(undefined);

  const setAll = (updater: (current: ChatItem[]) => ChatItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, working]);

  const send = async (text: string) => {
    const message = text.trim();

    if (!message || working) return;

    const assistantId = idRef.current + 1;

    idRef.current += 2;
    setInput("");
    setWorking(true);
    setAll((current) => [...current, { id: assistantId - 1, role: "user", text: message }, { id: assistantId, role: "assistant", text: "", steps: [], drafts: [] }]);

    const patch = (change: (item: ChatItem) => ChatItem) => setAll((current) => current.map((item) => (item.id === assistantId ? change(item) : item)));

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeHash: params.storeHash, messages: toHistory(itemsRef.current.filter((item) => item.id !== assistantId)) }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;

        patch((item) => ({ ...item, text: body?.error ?? "The copilot couldn't be reached. Try again." }));

        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");

        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const event = JSON.parse(line) as
            | { type: "step"; label: string }
            | { type: "draft"; proposal: { id: string; token: string; draft: Draft; preview: DraftView["preview"] } }
            | { type: "choices"; choices: { question: string; multiple: boolean; options: Array<{ label: string; prompt: string }> } }
            | { type: "message"; text: string }
            | { type: "error"; message: string };

          if (event.type === "step") patch((item) => ({ ...item, steps: [...(item.steps ?? []), event.label] }));
          else if (event.type === "message") patch((item) => ({ ...item, text: event.text }));
          else if (event.type === "choices") patch((item) => ({ ...item, choices: event.choices }));
          else if (event.type === "error") patch((item) => ({ ...item, text: event.message }));
          else if (event.type === "draft") {
            patch((item) => ({
              ...item,
              drafts: [...(item.drafts ?? []), { id: event.proposal.id, token: event.proposal.token, preview: event.proposal.preview, isCreate: event.proposal.draft.type === "create", status: "pending", draft: event.proposal.draft }],
            }));
          }
        }
      }
    } catch {
      patch((item) => ({ ...item, text: item.text || "The connection dropped. Try again." }));
    } finally {
      setWorking(false);
    }
  };

  // Prefill: a prompt handed in from elsewhere ("New promotion") without auto-send.
  const [prefilledNonce, setPrefilledNonce] = useState(seed && !seed.send ? seed.nonce : -1);
  if (seed && !seed.send && seed.nonce !== prefilledNonce) {
    setPrefilledNonce(seed.nonce);
    setInput(seed.text);
  }

  // Auto-send: a prompt handed in from elsewhere (recommendations) that should run now.
  useEffect(() => {
    if (!seed || !seed.send || handledSeed.current === seed.nonce) return;

    handledSeed.current = seed.nonce;
    void send(seed.text);
    // send is stable enough for this one-shot effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const choose = (itemId: number, prompts: string[]) => {
    setAll((current) => current.map((item) => (item.id === itemId && item.choices ? { ...item, choices: { ...item.choices, used: true } } : item)));
    void send(prompts.length === 1 ? prompts[0] : `Draft each of these as a separate draft:\n${prompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
  };

  const updateDraft = (draftId: string, change: Partial<DraftView>) =>
    setAll((current) => current.map((item) => ({ ...item, drafts: item.drafts?.map((d) => (d.id === draftId ? { ...d, ...change } : d)) })));

  const apply = async (draft: DraftView & { draft: Draft }) => {
    setBusyDraft(true);
    updateDraft(draft.id, { status: "applying", note: undefined });

    try {
      const result = await applyCopilotDraft(params.storeHash, draft.draft, draft.token);

      if (result.success) {
        updateDraft(draft.id, { status: "applied", note: result.message, promotionId: result.promotionId, enableToken: result.enableToken });
        showSuccessAlert(result.message);
        router.refresh();
      } else {
        updateDraft(draft.id, { status: "failed", note: result.message });
      }
    } catch {
      updateDraft(draft.id, { status: "failed", note: "Something went wrong. Nothing was saved." });
    } finally {
      setBusyDraft(false);
    }
  };

  const enable = async (draft: DraftView) => {
    if (draft.promotionId === undefined) return;

    setBusyDraft(true);

    try {
      const result = await setPromotionEnabled(params.storeHash, draft.promotionId, true, draft.enableToken);

      if (result.success) {
        updateDraft(draft.id, { enabled: true, note: result.message });
        showSuccessAlert(result.message);
        router.refresh();
      } else {
        showErrorAlert(result.message);
      }
    } catch {
      showErrorAlert("Something went wrong. Nothing was changed.");
    } finally {
      setBusyDraft(false);
    }
  };

  return (
    <aside className="pp-copilot" aria-label="Promotion copilot">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--pp-border)" }}>
        <span className="pp-brand__mark" style={{ width: 26, height: 26, borderRadius: 7 }}><ChatIcon size={14} /></span>
        <strong style={{ fontSize: 14 }}>Copilot</strong>
        <span style={{ flex: 1 }} />
        {items.length > 0 && (
          <button type="button" className="pp-btn" onClick={() => setAll(() => [])} disabled={working}>New chat</button>
        )}
        <button type="button" className="pp-btn pp-btn--icon" onClick={onClose} aria-label="Close copilot"><CloseIcon size={16} /></button>
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: "auto", fontSize: 14 }} aria-live="polite">
        {!configured && (
          <div className="pp-mode-banner" role="alert">The copilot isn&apos;t configured yet. Add PORTKEY_API_KEY to the server environment.</div>
        )}
        {items.length === 0 ? (
          <>
            <p style={{ margin: "0 0 12px" }}>Ask about your promotions, or have me draft and schedule new ones. I always show a draft for you to confirm before anything is saved.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" className="pp-btn" style={{ textAlign: "left", justifyContent: "flex-start", fontWeight: 500 }} onClick={() => void send(text)} disabled={!configured || working}>{text}</button>
              ))}
            </div>
          </>
        ) : (
          items.map((item) =>
            item.role === "user" ? (
              <div key={item.id} style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 12px" }}>
                <div style={{ background: "var(--pp-primary-soft)", borderRadius: 10, padding: "8px 12px", maxWidth: "88%", whiteSpace: "pre-wrap" }}>{item.text}</div>
              </div>
            ) : (
              <div key={item.id} style={{ margin: "0 0 16px" }}>
                {item.steps && item.steps.length > 0 && (
                  <div className="pp-muted" style={{ fontSize: 12, marginBottom: 6 }}>{[...new Set(item.steps)].join(" · ")}</div>
                )}
                {item.text ? <MessageText text={item.text} /> : working && item.id === itemsRef.current[itemsRef.current.length - 1]?.id ? <span className="pp-muted">Working…</span> : null}
                {item.choices && !item.choices.used && !working && item.id === itemsRef.current[itemsRef.current.length - 1]?.id && (
                  <div className="pp-choices" role="group" aria-label={item.choices.question}>
                    <div className="pp-choices__q">{item.choices.question}</div>
                    {item.choices.options.map((option, index) => {
                      const on = (picked[item.id] ?? []).includes(index);

                      return (
                        <button
                          key={option.label}
                          type="button"
                          className={`pp-choice${on ? " is-on" : ""}`}
                          aria-pressed={item.choices?.multiple ? on : undefined}
                          onClick={() => {
                            if (!item.choices?.multiple) return choose(item.id, [option.prompt]);

                            setPicked((current) => {
                              const now = current[item.id] ?? [];

                              return { ...current, [item.id]: now.includes(index) ? now.filter((i) => i !== index) : [...now, index] };
                            });
                          }}
                        >
                          {item.choices?.multiple && <span className="pp-choice__box" aria-hidden="true">{on ? "✓" : ""}</span>}
                          {option.label}
                        </button>
                      );
                    })}
                    {item.choices.multiple && (
                      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                        <button type="button" className="pp-btn pp-btn--primary" disabled={!(picked[item.id] ?? []).length} onClick={() => choose(item.id, (picked[item.id] ?? []).sort().map((i) => item.choices!.options[i].prompt))}>
                          Draft {(picked[item.id] ?? []).length || ""} selected
                        </button>
                        <button type="button" className="pp-btn" onClick={() => choose(item.id, item.choices!.options.map((o) => o.prompt))}>Draft all</button>
                      </div>
                    )}
                  </div>
                )}
                {item.drafts?.map((draft) => (
                  <DraftCard key={draft.id} draft={draft} busy={busyDraft} onApply={() => void apply(draft)} onDiscard={() => updateDraft(draft.id, { status: "discarded", note: "Discarded. Nothing was saved." })} onEnable={() => void enable(draft)} />
                ))}
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form
        style={{ padding: 12, borderTop: "1px solid var(--pp-border)", display: "flex", gap: 8, alignItems: "flex-end" }}
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="pp-input"
          style={{ flex: 1, minWidth: 0, resize: "none", height: 56, boxSizing: "border-box" }}
          placeholder={configured ? "Ask or describe a promotion…" : "Copilot isn't configured"}
          aria-label="Message the copilot"
          value={input}
          disabled={!configured}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="pp-btn pp-btn--primary" disabled={!configured || working || !input.trim()}>Send</button>
      </form>
    </aside>
  );
}
