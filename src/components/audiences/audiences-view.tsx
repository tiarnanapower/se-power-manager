"use client";

import { useMemo, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { addCustomersToCustomerSegment, createCustomerSegment } from "@/app/store/[storeHash]/audiences/actions";
import { PromotionDrawer } from "@/components/calendar/promotion-drawer";
import { StatePill } from "@/components/calendar/state-pill";
import { PlusIcon } from "@/components/shell/icons";
import { showErrorAlert, showSuccessAlert } from "@/components/ui/action-alerts";
import type { SegmentSummary } from "@/lib/audiences/segment-types";
import { formatRange } from "@/lib/promo-calendar/dates";
import type { CalendarPromotion, Conflict } from "@/lib/promo-calendar/types";

interface Props {
  promotions: CalendarPromotion[];
  conflicts: Conflict[];
  groups: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  segments: SegmentSummary[];
  // Why segments aren't available (null when they are).
  segmentsNote: string | null;
  timeZone?: string;
  currencySymbol?: string;
}

type Selection = { kind: "everyone" } | { kind: "group"; id: number } | { kind: "segment"; id: string } | { kind: "new-segment" };

const isCurrent = (p: CalendarPromotion) => p.state === "live" || p.state === "scheduled";
const byState = (a: CalendarPromotion, b: CalendarPromotion) => Number(a.state === "scheduled") - Number(b.state === "scheduled");

function PromotionTable({ rows, timeZone, onOpen }: { rows: CalendarPromotion[]; timeZone: string; onOpen(id: number): void }) {
  return (
    <table className="pp-table">
      <thead>
        <tr><th>Promotion</th><th>Status</th><th>Reward</th><th>Runs</th></tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} onClick={() => onOpen(p.id)}>
            <td style={{ fontWeight: 600 }}>{p.displayName}</td>
            <td><StatePill state={p.state} /></td>
            <td>{p.discountSummary}</td>
            <td>{formatRange(p, timeZone)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pp-aud-section">
      <div className="pp-aud-section__head">
        <h3>{title}</h3>
        {hint && <span className="pp-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NewSegmentForm({ storeHash, onCreated }: { storeHash: string | undefined; onCreated(id: string): void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await createCustomerSegment(storeHash, { name, description });

      if (result.success && result.segmentId) {
        showSuccessAlert(result.message);
        onCreated(result.segmentId);
      } else {
        showErrorAlert(result.message);
      }
    });
  };

  return (
    <form className="pp-form" onSubmit={submit}>
      <label>
        <span>Segment name</span>
        <input className="pp-input" value={name} maxLength={100} required placeholder="e.g. High spenders" onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>Description <span className="pp-muted">(optional)</span></span>
        <input className="pp-input" value={description} maxLength={255} placeholder="Who is in this segment?" onChange={(event) => setDescription(event.target.value)} />
      </label>
      <p className="pp-muted" style={{ margin: 0, fontSize: 12.5 }}>Creates an empty segment through the Segmentation API. Add customers to it next, then target it from a promotion.</p>
      <div><button type="submit" className="pp-btn pp-btn--primary" disabled={pending || name.trim() === ""}>{pending ? "Creating…" : "Create segment"}</button></div>
    </form>
  );
}

function AddCustomers({ storeHash, segment, onDone }: { storeHash: string | undefined; segment: SegmentSummary; onDone(): void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const emails = useMemo(() => [...new Set(text.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))], [text]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await addCustomersToCustomerSegment(storeHash, segment.id, emails);

      if (result.success) {
        showSuccessAlert(result.message);
        setText("");
        onDone();
      } else {
        showErrorAlert(result.message);
      }
    });
  };

  return (
    <form className="pp-form" onSubmit={submit}>
      <label>
        <span>Add customers by email <span className="pp-muted">(up to 50, registered customers only)</span></span>
        <textarea className="pp-input" rows={3} value={text} placeholder={"jane@example.com, sam@example.com"} onChange={(event) => setText(event.target.value)} />
      </label>
      <div>
        <button type="submit" className="pp-btn" disabled={pending || emails.length === 0 || emails.length > 50}>
          {pending ? "Adding…" : `Add ${emails.length || ""} to segment`.replace("  ", " ")}
        </button>
      </div>
    </form>
  );
}

// Everyone, customer groups and customer segments: what each audience is offered.
export function AudiencesView({ promotions, conflicts, groups, channels, segments, segmentsNote, timeZone = "UTC", currencySymbol = "" }: Props) {
  const router = useRouter();
  const params = useParams<{ storeHash?: string }>();
  const [selection, setSelection] = useState<Selection>({ kind: "everyone" });
  const [openId, setOpenId] = useState<number | undefined>();
  const [, startRefresh] = useTransition();
  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const segmentNames = useMemo(() => new Map(segments.map((s) => [s.id, s.name])), [segments]);
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);
  const byId = useMemo(() => new Map(promotions.map((p) => [p.id, p])), [promotions]);
  const current = useMemo(() => promotions.filter(isCurrent), [promotions]);

  // For each audience: promotions made for it, and store-wide ones it also gets.
  const view = (target: Selection) => {
    const storeWide = (extra: (p: CalendarPromotion) => boolean) => current.filter((p) => p.audience.everyone && p.audience.segmentIds.length === 0 && !p.audience.hasSegments && extra(p)).sort(byState);

    if (target.kind === "group") {
      const id = target.id;

      return {
        targeted: current.filter((p) => !p.audience.everyone && p.audience.groupIds.includes(id) && !p.audience.excludedGroupIds.includes(id)).sort(byState),
        storeWide: storeWide((p) => !p.audience.excludedGroupIds.includes(id)),
      };
    }

    if (target.kind === "segment") {
      const id = target.id;

      return {
        targeted: current.filter((p) => p.audience.segmentIds.includes(id)).sort(byState),
        storeWide: storeWide((p) => !p.audience.excludedSegmentIds.includes(id)),
      };
    }

    return { targeted: [] as CalendarPromotion[], storeWide: storeWide(() => true) };
  };

  const counts = (target: Selection) => {
    const { targeted, storeWide } = view(target);
    const all = [...targeted, ...storeWide];

    return `${all.filter((p) => p.state === "live").length} live · ${all.filter((p) => p.state === "scheduled").length} scheduled`;
  };

  const selectedSegment = selection.kind === "segment" ? segments.find((s) => s.id === selection.id) : undefined;
  const selectedGroup = selection.kind === "group" ? groups.find((g) => g.id === selection.id) : undefined;
  const { targeted, storeWide } = view(selection);
  const open = openId === undefined ? undefined : byId.get(openId);
  const isActive = (target: Selection) => JSON.stringify(target) === JSON.stringify(selection);
  const refresh = () => startRefresh(() => router.refresh());
  const title = selection.kind === "everyone" ? "Everyone" : selection.kind === "new-segment" ? "New customer segment" : (selectedGroup?.name ?? selectedSegment?.name ?? "Audience");
  const subtitle =
    selection.kind === "everyone"
      ? "Promotions open to every shopper, including guests."
      : selection.kind === "group"
        ? "A customer group. Shoppers are placed in one group on their account."
        : selection.kind === "segment"
          ? (selectedSegment?.description || "A customer segment. Shoppers can belong to many segments.")
          : "";

  return (
    <div className="pp-split">
      <nav className="pp-card pp-split__list" aria-label="Audiences">
        <button type="button" className="pp-split__item" aria-current={isActive({ kind: "everyone" })} onClick={() => setSelection({ kind: "everyone" })}>
          <span className="pp-split__name">Everyone</span>
          <span className="pp-muted pp-split__note">{counts({ kind: "everyone" })}</span>
        </button>

        <div className="pp-split__heading">Customer groups <span>{groups.length}</span></div>
        {groups.length === 0 && <div className="pp-muted pp-split__empty">No customer groups</div>}
        {groups.map((group) => (
          <button key={group.id} type="button" className="pp-split__item" aria-current={isActive({ kind: "group", id: group.id })} onClick={() => setSelection({ kind: "group", id: group.id })}>
            <span className="pp-split__name">{group.name}</span>
            <span className="pp-muted pp-split__note">{counts({ kind: "group", id: group.id })}</span>
          </button>
        ))}

        <div className="pp-split__heading">
          Customer segments <span>{segments.length}</span>
          {!segmentsNote && (
            <button type="button" className="pp-split__add" aria-label="New segment" title="New segment" onClick={() => setSelection({ kind: "new-segment" })}><PlusIcon size={14} /></button>
          )}
        </div>
        {segmentsNote && <div className="pp-muted pp-split__empty">{segmentsNote}</div>}
        {!segmentsNote && segments.length === 0 && <div className="pp-muted pp-split__empty">No segments yet</div>}
        {segments.map((segment) => (
          <button key={segment.id} type="button" className="pp-split__item" aria-current={isActive({ kind: "segment", id: segment.id })} onClick={() => setSelection({ kind: "segment", id: segment.id })}>
            <span className="pp-split__name">{segment.name}</span>
            <span className="pp-muted pp-split__note">{segment.memberCount === null ? "" : `${segment.memberCount} ${segment.memberCount === 1 ? "customer" : "customers"} · `}{counts({ kind: "segment", id: segment.id })}</span>
          </button>
        ))}
      </nav>

      <section className="pp-card" aria-label={title}>
        <div style={{ padding: "16px 18px 6px" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          {subtitle && <p className="pp-muted" style={{ margin: "2px 0 0", fontSize: 13 }}>{subtitle}</p>}
          {selectedSegment && (
            <p className="pp-muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
              {selectedSegment.memberCount === null ? "Member count unavailable" : `${selectedSegment.memberCount} ${selectedSegment.memberCount === 1 ? "customer" : "customers"}`}
              {selectedSegment.createdAt ? ` · created ${new Date(selectedSegment.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </p>
          )}
        </div>

        {selection.kind === "new-segment" ? (
          <NewSegmentForm
            storeHash={params.storeHash}
            onCreated={(id) => {
              setSelection({ kind: "segment", id });
              refresh();
            }}
          />
        ) : (
          <>
            {selectedSegment && (
              <Section title="Add customers" hint="Uses the Segmentation API">
                <AddCustomers storeHash={params.storeHash} segment={selectedSegment} onDone={refresh} />
              </Section>
            )}
            {selection.kind !== "everyone" && (
              <Section title={`Made for ${title}`} hint={targeted.length === 0 ? undefined : `${targeted.length} promotion${targeted.length === 1 ? "" : "s"}`}>
                {targeted.length === 0 ? <p className="pp-muted pp-aud-empty">Nothing targets this audience yet. Ask Copilot to draft one, or target it in BigCommerce.</p> : <PromotionTable rows={targeted} timeZone={timeZone} onOpen={setOpenId} />}
              </Section>
            )}
            <Section title="Store-wide offers" hint={selection.kind === "everyone" ? undefined : "They also get these"}>
              {storeWide.length === 0 ? <p className="pp-muted pp-aud-empty">No live or scheduled store-wide promotions.</p> : <PromotionTable rows={storeWide} timeZone={timeZone} onOpen={setOpenId} />}
            </Section>
          </>
        )}
      </section>

      {open && (
        <PromotionDrawer promotion={open} conflicts={conflicts.filter((c) => c.promotionIds.includes(open.id))} allPromotions={byId} groupNames={groupNames} channelNames={channelNames} timeZone={timeZone} currencySymbol={currencySymbol} segmentNames={segmentNames} onClose={() => setOpenId(undefined)} onSelect={setOpenId} />
      )}
    </div>
  );
}
