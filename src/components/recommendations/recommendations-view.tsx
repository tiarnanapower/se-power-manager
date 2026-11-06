"use client";

import { useMemo, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { generateIdeas } from "@/app/store/[storeHash]/recommendations/actions";
import { useCopilot } from "@/components/shell/copilot-context";
import { AlertIcon, CalendarIcon, SparkIcon, TagIcon, TrendIcon, UsersIcon } from "@/components/shell/icons";
import type { Recommendation, RecommendationKind } from "@/lib/promo-calendar/recommendations";

const KIND: Record<RecommendationKind, { label: string; icon: React.ReactNode; tone: string }> = {
  season: { label: "Seasonal", icon: <CalendarIcon size={18} />, tone: "violet" },
  gap: { label: "Gaps", icon: <TrendIcon size={18} />, tone: "blue" },
  stacking: { label: "Stacking", icon: <AlertIcon size={18} />, tone: "amber" },
  audience: { label: "Audiences", icon: <UsersIcon size={18} />, tone: "slate" },
  ending: { label: "Ending soon", icon: <TagIcon size={18} />, tone: "red" },
  ai: { label: "AI ideas", icon: <SparkIcon size={18} />, tone: "violet" },
};

const PAGE = 6;

export function RecommendationsView({ recommendations }: { recommendations: Recommendation[] }) {
  const copilot = useCopilot();
  const params = useParams<{ storeHash?: string }>();
  const [filter, setFilter] = useState<RecommendationKind | "all">("all");
  const [ideas, setIdeas] = useState<Recommendation[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  // Newest AI ideas first, then the rule-based ones.
  const all = useMemo(() => [...ideas, ...recommendations], [ideas, recommendations]);
  const kinds = useMemo(() => (Object.keys(KIND) as RecommendationKind[]).filter((kind) => all.some((r) => r.kind === kind)), [all]);
  const matching = filter === "all" ? all : all.filter((r) => r.kind === filter);
  const shown = expanded ? matching : matching.slice(0, PAGE);

  const refresh = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await generateIdeas(params.storeHash, all.map((r) => r.title).slice(0, 60));

      if (result.success) {
        setIdeas((current) => [...result.ideas, ...current]);
        setFilter("all");
        setExpanded(false);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <button type="button" className="pp-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All ({all.length})</button>
        {kinds.map((kind) => (
          <button key={kind} type="button" className="pp-chip" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>
            {KIND[kind].label} ({all.filter((r) => r.kind === kind).length})
          </button>
        ))}
        <button type="button" className="pp-btn pp-btn--primary" style={{ marginLeft: "auto" }} onClick={refresh} disabled={pending}>
          {pending ? "Thinking…" : "Refresh ideas"}
        </button>
      </div>
      {error && <p role="alert" style={{ margin: "0 0 12px", color: "var(--pp-invalid)", fontSize: 13 }}>{error}</p>}

      {matching.length === 0 ? (
        <section className="pp-card" style={{ padding: 28, textAlign: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Nothing to recommend right now</h2>
          <p className="pp-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>Your calendar covers the upcoming retail moments. Press Refresh ideas for AI suggestions for this time of year.</p>
        </section>
      ) : (
        <section className="pp-card" aria-label="Recommendations">
          <ul className="pp-reco">
            {shown.map((rec) => (
              <li key={rec.id} className="pp-reco__item">
                <span className={`pp-stat__icon pp-stat--${KIND[rec.kind].tone}`}>{KIND[rec.kind].icon}</span>
                <div className="pp-reco__body">
                  <div className="pp-reco__title">{rec.title}</div>
                  <div className="pp-muted pp-reco__detail">{rec.detail}</div>
                </div>
                <span className={`pp-reco__when${rec.priority === "high" ? " is-high" : ""}`}>{rec.when}</span>
                <button type="button" className="pp-btn" onClick={() => copilot.ask(rec.prompt)}>{rec.cta}</button>
              </li>
            ))}
          </ul>
          {matching.length > PAGE && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--pp-border)", textAlign: "center" }}>
              <button type="button" className="pp-btn" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show all ${matching.length}`}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
