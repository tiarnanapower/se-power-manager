"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import multiMonthPlugin from "@fullcalendar/multimonth";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg } from "@fullcalendar/core";
import { reschedulePromotion } from "@/app/store/[storeHash]/promotions/actions";
import { AlwaysOnCards } from "@/components/calendar/always-on-cards";
import { TimelineView } from "@/components/calendar/timeline-view";
import { PromotionDrawer } from "@/components/calendar/promotion-drawer";
import { type PendingReschedule, RescheduleDialog } from "@/components/calendar/reschedule-dialog";
import { StatCards } from "@/components/calendar/stat-cards";
import { STATE_LABEL, STATE_VARS } from "@/components/calendar/state-style";
import { ChevronLeftIcon, ChevronRightIcon, TagIcon } from "@/components/shell/icons";
import { showErrorAlert, showSuccessAlert } from "@/components/ui/action-alerts";
import { appliesToGroup } from "@/lib/promo-calendar/audience-filter";
import { isAlwaysOn, toCalendarEvent } from "@/lib/promo-calendar/calendar-events";
import { findConflicts } from "@/lib/promo-calendar/conflicts";
import { DAY_MS, formatDay, formatShortDay } from "@/lib/promo-calendar/dates";
import { defaultWindowStart, shiftWindow, type TimelineZoom, ZOOMS } from "@/lib/promo-calendar/timeline";
import { addDaysToKey, shiftDaysInZone, zoneAbbreviation, zonedDayKey } from "@/lib/promo-calendar/zone";
import type { DateGap } from "@/lib/promo-calendar/gaps";
import type { CalendarPromotion, Conflict, LifecycleState } from "@/lib/promo-calendar/types";
import type { CalendarViewKey } from "@/lib/preferences";
import { useIsClient, usePreferences } from "@/lib/use-preferences";

export interface CalendarViewProps {
  promotions: CalendarPromotion[];
  conflicts: Conflict[];
  gaps: DateGap[];
  groups: Array<{ id: number; name: string }>;
  channels: Array<{ id: number; name: string }>;
  nowIso: string;
  timeZone: string;
  timeZoneFromStore: boolean;
  currencySymbol?: string;
  segments?: Array<{ id: string; name: string }>;
}

const FC_VIEW: Record<Exclude<CalendarViewKey, "timeline">, string> = { month: "dayGridMonth", week: "dayGridWeek", quarter: "multiMonthQuarter" };
const VIEW_LABEL: Record<CalendarViewKey, string> = { month: "Month", week: "Week", quarter: "Quarter", timeline: "Timeline" };
const KIND_KEY: Array<[string, string]> = [["percent", "% off"], ["amount", "Amount off"], ["shipping", "Free shipping"], ["gift", "Gift"], ["other", "Other"]];
const STATE_FILTERS: LifecycleState[] = ["live", "scheduled", "ended", "disabled"];
// Used-up and invalid promotions travel with the "ended" and "disabled" filters.
const FILTER_OF: Record<LifecycleState, LifecycleState> = { live: "live", scheduled: "scheduled", ended: "ended", exhausted: "ended", disabled: "disabled", invalid: "disabled" };

export function CalendarView({ promotions, conflicts, gaps, groups, channels, nowIso, timeZone, timeZoneFromStore, currencySymbol, segments = [] }: CalendarViewProps) {
  const router = useRouter();
  const params = useParams<{ storeHash?: string }>();
  const [refreshing, startRefresh] = useTransition();
  const isClient = useIsClient();
  const [preferences] = usePreferences();
  const calendarRef = useRef<FullCalendar>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  // FullCalendar runs in UTC; we hand it the store's calendar days as plain dates.
  const todayKey = useMemo(() => zonedDayKey(now, timeZone), [now, timeZone]);

  const [viewOverride, setViewOverride] = useState<CalendarViewKey | undefined>();
  const view = viewOverride ?? preferences.defaultView;
  const [title, setTitle] = useState("");
  const isTimeline = view === "timeline";
  const [zoom, setZoom] = useState<TimelineZoom>("weeks");
  const [timelineStart, setTimelineStart] = useState<string | undefined>();
  const windowStart = timelineStart ?? defaultWindowStart(todayKey, zoom);
  const windowTitle = `${formatShortDay(new Date(`${windowStart}T12:00:00Z`))} to ${formatDay(new Date(`${addDaysToKey(windowStart, ZOOMS[zoom].spanDays - 1)}T12:00:00Z`))}`;
  const [visibleStates, setVisibleStates] = useState<Set<LifecycleState>>(new Set(["live", "scheduled"]));
  const [showCoupons, setShowCoupons] = useState(true);
  const [groupId, setGroupId] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [pending, setPending] = useState<PendingReschedule | undefined>();
  const [saving, setSaving] = useState(false);
  const revertRef = useRef<(() => void) | undefined>(undefined);

  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const segmentNames = useMemo(() => new Map(segments.map((s) => [s.id, s.name])), [segments]);
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);
  const byId = useMemo(() => new Map(promotions.map((p) => [p.id, p])), [promotions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return promotions.filter(
      (p) =>
        visibleStates.has(FILTER_OF[p.state]) &&
        (showCoupons || p.redemption === "AUTOMATIC") &&
        (groupId === undefined || appliesToGroup(p.audience, groupId)) &&
        (needle === "" || p.displayName.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle)),
    );
  }, [promotions, visibleStates, showCoupons, groupId, query]);

  const warnings = useMemo(() => conflicts.filter((c) => c.severity === "warning"), [conflicts]);
  const conflictIds = useMemo(() => new Set(warnings.flatMap((c) => c.promotionIds)), [warnings]);
  const alwaysOn = useMemo(() => filtered.filter(isAlwaysOn), [filtered]);
  const events = useMemo(
    () => filtered.map((p) => toCalendarEvent(p, now, conflictIds, timeZone)).filter((e): e is NonNullable<typeof e> => e !== undefined),
    [filtered, now, conflictIds, timeZone],
  );
  const counts = useMemo(() => {
    const scheduled = promotions.filter((p) => p.state === "scheduled" && p.start).sort((a, b) => a.start!.getTime() - b.start!.getTime());

    return {
      live: promotions.filter((p) => p.state === "live").length,
      scheduled: scheduled.length,
      next: scheduled[0],
    };
  }, [promotions]);
  const gapDays = useMemo(() => {
    const set = new Set<string>();

    for (const gap of gaps) {
      const last = zonedDayKey(gap.to, timeZone);

      for (let key = zonedDayKey(gap.from, timeZone); key <= last; key = addDaysToKey(key, 1)) set.add(key);
    }

    return set;
  }, [gaps, timeZone]);
  const gapDayCount = gapDays.size;

  // Keep FullCalendar's view in step with the chosen one.
  useEffect(() => {
    if (view !== "timeline") calendarRef.current?.getApi().changeView(FC_VIEW[view]);
  }, [view, isClient]);

  const api = () => calendarRef.current?.getApi();
  const goPrev = () => (isTimeline ? setTimelineStart(shiftWindow(windowStart, zoom, -1)) : api()?.prev());
  const goNext = () => (isTimeline ? setTimelineStart(shiftWindow(windowStart, zoom, 1)) : api()?.next());
  const goToday = () => (isTimeline ? setTimelineStart(undefined) : api()?.today());
  const changeZoom = (next: TimelineZoom) => {
    setZoom(next);
    setTimelineStart(undefined);
  };
  const toggleState = (state: LifecycleState) =>
    setVisibleStates((current) => {
      const next = new Set(current);

      if (next.has(state)) next.delete(state);
      else next.add(state);

      return next;
    });

  const onEventClick = (info: EventClickArg) => {
    info.jsEvent.preventDefault();
    setSelectedId(Number(info.event.extendedProps.promotionId));
  };

  // Drag or resize: work out the new dates, then ask before touching the store.
  const onScheduleChange = useCallback(
    (info: EventDropArg | EventResizeDoneArg) => {
      const promotion = byId.get(Number(info.event.extendedProps.promotionId));
      const oldStart = info.oldEvent.start;
      const newStart = info.event.start;

      if (!promotion?.start || !promotion.end || !oldStart || !newStart) {
        info.revert();

        return;
      }

      const oldEnd = info.oldEvent.end ?? new Date(oldStart.getTime() + DAY_MS);
      const newEnd = info.event.end ?? new Date(newStart.getTime() + DAY_MS);
      // Calendar days moved, applied in the store's time zone so times of day survive DST.
      const startDays = Math.round((newStart.getTime() - oldStart.getTime()) / DAY_MS);
      const endDays = Math.round((newEnd.getTime() - oldEnd.getTime()) / DAY_MS);
      const nextStart = shiftDaysInZone(promotion.start, startDays, timeZone);
      const nextEnd = shiftDaysInZone(promotion.end, endDays, timeZone);

      if (nextEnd.getTime() <= nextStart.getTime()) {
        showErrorAlert("The end date must be after the start date.");
        info.revert();

        return;
      }

      const before = new Set(conflicts.map((c) => c.promotionIds.join("-")));
      const moved = promotions.map((p) => (p.id === promotion.id ? { ...p, start: nextStart, end: nextEnd } : p));
      const newConflicts = findConflicts(moved).filter((c) => c.promotionIds.includes(promotion.id) && !before.has(c.promotionIds.join("-")));

      revertRef.current = info.revert;
      setPending({
        promotion,
        nextStart,
        nextEnd,
        newConflicts,
        startsImmediately: promotion.state === "scheduled" && nextStart.getTime() <= now.getTime(),
        endsImmediately: nextEnd.getTime() < now.getTime(),
      });
    },
    [byId, conflicts, promotions, now, timeZone],
  );

  const cancelReschedule = () => {
    revertRef.current?.();
    revertRef.current = undefined;
    setPending(undefined);
  };

  const confirmReschedule = async () => {
    if (!pending) return;

    setSaving(true);

    try {
      const { promotion, nextStart, nextEnd } = pending;
      const result = await reschedulePromotion(params.storeHash, {
        id: promotion.id,
        expectedStart: promotion.start?.toISOString() ?? null,
        expectedEnd: promotion.end?.toISOString() ?? null,
        start: nextStart?.toISOString() ?? null,
        end: nextEnd?.toISOString() ?? null,
      });

      if (result.success) {
        showSuccessAlert(result.message);
        revertRef.current = undefined;
        setPending(undefined);
        startRefresh(() => router.refresh());
      } else {
        showErrorAlert(result.message);
        cancelReschedule();
      }
    } catch (error) {
      showErrorAlert(error instanceof Error ? error.message : "Something went wrong. Nothing was saved.");
      cancelReschedule();
    } finally {
      setSaving(false);
    }
  };

  const selected = selectedId === undefined ? undefined : byId.get(selectedId);

  return (
    <div>
      <StatCards
        stats={[
          { label: "Live now", value: counts.live, hint: `${promotions.length} promotions in total`, tone: "blue", icon: "live" },
          { label: "Scheduled", value: counts.scheduled, hint: counts.next?.start ? `Next starts ${formatShortDay(counts.next.start, timeZone)}` : "Nothing coming up", tone: "violet", icon: "scheduled" },
          { label: "Overlapping promotions", value: conflicts.length, hint: conflicts.length === 0 ? "No overlaps found" : `${warnings.length} can't both apply · ${conflicts.length - warnings.length} will stack`, tone: warnings.length ? "red" : conflicts.length ? "amber" : "slate", icon: "alert" },
          { label: "Days without a site-wide offer", value: gapDayCount, hint: "In the next 90 days", tone: gapDayCount ? "amber" : "slate", icon: "gap" },
        ]}
      />
      {preferences.showAlwaysOn && !isTimeline && <AlwaysOnCards promotions={alwaysOn} selectedId={selectedId} groupNames={groupNames} timeZone={timeZone} segmentNames={segmentNames} onSelect={setSelectedId} />}

      <section className="pp-card" aria-label="Calendar" aria-busy={refreshing}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "14px 16px 6px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="pp-btn pp-btn--icon" onClick={goPrev} aria-label="Previous"><ChevronLeftIcon size={16} /></button>
            <button type="button" className="pp-btn" onClick={goToday}>Today</button>
            <button type="button" className="pp-btn pp-btn--icon" onClick={goNext} aria-label="Next"><ChevronRightIcon size={16} /></button>
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, minWidth: 180 }}>{isTimeline ? windowTitle : title}</h2>
          {isTimeline && (
            <div className="pp-seg" role="group" aria-label="Timeline zoom" style={{ marginLeft: "auto" }}>
              {(Object.keys(ZOOMS) as TimelineZoom[]).map((key) => (
                <button key={key} type="button" className="pp-seg__btn" aria-pressed={zoom === key} onClick={() => changeZoom(key)}>{ZOOMS[key].label}</button>
              ))}
            </div>
          )}
          <div className="pp-seg" role="group" aria-label="Calendar view" style={isTimeline ? undefined : { marginLeft: "auto" }}>
            {(Object.keys(VIEW_LABEL) as CalendarViewKey[]).map((key) => (
              <button key={key} type="button" className="pp-seg__btn" aria-pressed={view === key} onClick={() => setViewOverride(key)}>{VIEW_LABEL[key]}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 16px 10px" }}>
          {STATE_FILTERS.map((state) => (
            <button key={state} type="button" className="pp-chip" style={STATE_VARS[state]} aria-pressed={visibleStates.has(state)} onClick={() => toggleState(state)}><span className="pp-chip__dot" aria-hidden />{STATE_LABEL[state]}</button>
          ))}
          <button type="button" className="pp-chip" aria-pressed={showCoupons} onClick={() => setShowCoupons((value) => !value)}>Coupons</button>
          <span style={{ flex: 1 }} />
          <input className="pp-input" type="search" placeholder="Search promotions" aria-label="Search promotions" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="pp-input" aria-label="Audience" value={groupId ?? "all"} onChange={(event) => setGroupId(event.target.value === "all" ? undefined : Number(event.target.value))}>
            <option value="all">All audiences</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>

        <div className="pp-legend">
          {gapDayCount > 0 && (
            <>
              <span className="pp-legend__swatch" aria-hidden /> Shaded days have no automatic offer open to every shopper
            </>
          )}
          <span className="pp-legend__kinds" aria-label="Colour key">
            {KIND_KEY.map(([kind, label]) => (
              <span key={kind} className={`pp-ev--k-${kind}`}><span className="pp-kind-dot" aria-hidden />{label}</span>
            ))}
            <span className="pp-legend__style"><span className="pp-legend__outline" aria-hidden />Scheduled</span>
            <span className="pp-legend__style"><span className="pp-legend__dashed" aria-hidden />Disabled</span>
          </span>
          <span className="pp-legend__tz" title={timeZoneFromStore ? "Taken from your store settings" : "Couldn't read the store's time zone, so UTC is shown. Add the Information & Settings (read-only) scope to use it."}>
            Times in {timeZone} ({zoneAbbreviation(now, timeZone)}){timeZoneFromStore ? "" : " · default"}
          </span>
        </div>
        {isTimeline ? (
          isClient ? (
            <TimelineView promotions={filtered} conflictIds={conflictIds} gapDays={gapDays} timeZone={timeZone} todayKey={todayKey} startKey={windowStart} zoom={zoom} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div style={{ height: 360 }} aria-hidden />
          )
        ) : (
        <div className="pp-cal">
          {isClient ? (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, multiMonthPlugin, interactionPlugin]}
              initialView={FC_VIEW[view as Exclude<CalendarViewKey, "timeline">]}
              initialDate={todayKey}
              now={todayKey}
              timeZone="UTC"
              headerToolbar={false}
              height="auto"
              firstDay={preferences.weekStartsOn}
              fixedWeekCount={false}
              events={events}
              eventClick={onEventClick}
              eventDrop={onScheduleChange}
              eventResize={onScheduleChange}
              eventResizableFromStart
              dayMaxEvents={5}
              dayCellClassNames={(arg) => (gapDays.has(arg.date.toISOString().slice(0, 10)) ? ["pp-gap"] : [])}
              moreLinkClick="popover"
              views={{
                dayGridWeek: { dayMaxEvents: false },
                multiMonthQuarter: { type: "multiMonth", duration: { months: 3 }, multiMonthMaxColumns: 3 },
              }}
              datesSet={(arg) => setTitle(arg.view.title)}
              eventContent={(arg) => (
                <span className="pp-ev__row">
                  {arg.event.extendedProps.coupon && <TagIcon size={11} />}
                  <span className="pp-ev__title">{arg.event.title}</span>
                  <span className="pp-ev__meta">{arg.event.extendedProps.summary}</span>
                </span>
              )}
            />
          ) : (
            <div style={{ height: 560 }} aria-hidden />
          )}
        </div>
        )}
      </section>

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
      <RescheduleDialog pending={pending} saving={saving} timeZone={timeZone} onConfirm={confirmReschedule} onCancel={cancelReschedule} />
    </div>
  );
}
