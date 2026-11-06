"use client";

import { useMemo, useState } from "react";
import { PromotionDrawer } from "@/components/calendar/promotion-drawer";
import { StatePill } from "@/components/calendar/state-pill";
import { STATE_LABEL } from "@/components/calendar/state-style";
import { describeAudience } from "@/lib/promo-calendar/audience-filter";
import { formatRange } from "@/lib/promo-calendar/dates";
import type { CalendarPromotion, Conflict, LifecycleState } from "@/lib/promo-calendar/types";

interface Props {
  promotions: CalendarPromotion[];
  conflicts: Conflict[];
  groups: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  timeZone?: string;
  currencySymbol?: string;
  segments?: Array<{ id: string; name: string }>;
}

const STATE_ORDER: LifecycleState[] = ["live", "scheduled", "exhausted", "disabled", "ended", "invalid"];

export function PromotionsListView({ promotions, conflicts, groups, channels, timeZone = "UTC", currencySymbol = "", segments = [] }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LifecycleState | "all">("all");
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const segmentNames = useMemo(() => new Map(segments.map((s) => [s.id, s.name])), [segments]);
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);
  const byId = useMemo(() => new Map(promotions.map((p) => [p.id, p])), [promotions]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return promotions
      .filter((p) => (state === "all" || p.state === state) && (needle === "" || p.displayName.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)))
      .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  }, [promotions, query, state]);

  const selected = selectedId === undefined ? undefined : byId.get(selectedId);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input className="pp-input" type="search" placeholder="Search promotions" aria-label="Search promotions" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="pp-input" aria-label="Status" value={state} onChange={(event) => setState(event.target.value as LifecycleState | "all")}>
          <option value="all">All statuses</option>
          {STATE_ORDER.map((key) => (
            <option key={key} value={key}>{STATE_LABEL[key]}</option>
          ))}
        </select>
        <span className="pp-muted" style={{ marginLeft: "auto", fontSize: 13 }}>{rows.length} of {promotions.length}</span>
      </div>
      <div className="pp-card" style={{ overflowX: "auto" }}>
        <table className="pp-table">
          <thead>
            <tr>
              <th scope="col">Promotion</th>
              <th scope="col">Status</th>
              <th scope="col">Reward</th>
              <th scope="col">Runs</th>
              <th scope="col">Audience</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} onClick={() => setSelectedId(p.id)}>
                <td>
                  <button type="button" className="pp-btn" style={{ border: "none", background: "none", padding: 0, fontWeight: 700 }} onClick={() => setSelectedId(p.id)}>{p.displayName}</button>
                </td>
                <td><StatePill state={p.state} /></td>
                <td>{p.discountSummary}</td>
                <td>{formatRange(p, timeZone)}</td>
                <td>{describeAudience(p.audience, groupNames, segmentNames)}</td>
                <td>{p.redemption === "COUPON" ? "Coupon" : "Automatic"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="pp-muted" style={{ textAlign: "center", padding: 32 }}>No promotions match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && (
        <PromotionDrawer
          promotion={selected}
          conflicts={conflicts.filter((c) => c.promotionIds.includes(selected.id))}
          allPromotions={byId}
          groupNames={groupNames}
          channelNames={channelNames}
          timeZone={timeZone}
          currencySymbol={currencySymbol}
          segmentNames={segmentNames}
          onClose={() => setSelectedId(undefined)}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}
