// Rule-based promotion recommendations: pure, so they are fast, explainable
// and unit tested. Each one carries a prompt the copilot can turn into a draft.
import { formatDay, formatShortDay } from "@/lib/promo-calendar/dates";
import type { DateGap } from "@/lib/promo-calendar/gaps";
import type { CalendarPromotion, Conflict } from "@/lib/promo-calendar/types";
import { addDaysToKey, diffDayKeys, startOfZonedDay, zonedDayKey } from "@/lib/promo-calendar/zone";

export type RecommendationKind = "season" | "gap" | "stacking" | "audience" | "ending" | "ai";

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  // Short label on the right, e.g. "In 12 days".
  when: string;
  cta: string;
  prompt: string;
  // Sort key: when this matters (days from today).
  sortDays: number;
}

export interface SeasonalMoment {
  id: string;
  name: string;
  startKey: string;
  endKey: string; // inclusive
}

function nthWeekdayKey(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;

  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)).toISOString().slice(0, 10);
}

// Retail moments for a calendar year (dates are the store's days).
export function seasonalMoments(year: number): SeasonalMoment[] {
  const blackFriday = addDaysToKey(nthWeekdayKey(year, 11, 4, 4), 1);

  return [
    { id: `valentines-${year}`, name: "Valentine's Day", startKey: `${year}-02-07`, endKey: `${year}-02-14` },
    { id: `black-friday-${year}`, name: "Black Friday weekend", startKey: blackFriday, endKey: addDaysToKey(blackFriday, 2) },
    { id: `cyber-monday-${year}`, name: "Cyber Monday", startKey: addDaysToKey(blackFriday, 3), endKey: addDaysToKey(blackFriday, 3) },
    { id: `christmas-${year}`, name: "Last-minute Christmas gifting", startKey: `${year}-12-14`, endKey: `${year}-12-20` },
    { id: `new-year-${year}`, name: "Boxing Day and New Year sale", startKey: `${year}-12-26`, endKey: `${year + 1}-01-01` },
  ];
}

const daysLabel = (days: number) => (days <= 0 ? "Now" : days === 1 ? "Tomorrow" : `In ${days} days`);

function priorityFor(days: number): Recommendation["priority"] {
  return days <= 45 ? "high" : days <= 90 ? "medium" : "low";
}

interface Input {
  promotions: CalendarPromotion[];
  conflicts: Conflict[];
  gaps: DateGap[];
  groups: Array<{ id: number; name: string }>;
  now: Date;
  timeZone: string;
}

export function buildRecommendations({ promotions, conflicts, gaps, groups, now, timeZone }: Input): Recommendation[] {
  const todayKey = zonedDayKey(now, timeZone);
  const out: Recommendation[] = [];
  const current = promotions.filter((p) => p.state === "live" || p.state === "scheduled");
  // Only dated promotions count as a campaign: an always-on offer is not a Black Friday plan.
  const campaigns = current.filter((p) => p.end !== null);

  // 1. Retail moments with no campaign planned.
  const year = Number(todayKey.slice(0, 4));

  for (const moment of [...seasonalMoments(year), ...seasonalMoments(year + 1)]) {
    if (moment.endKey < todayKey) continue;

    const days = Math.max(diffDayKeys(todayKey, moment.startKey), 0);

    if (days > 150) continue;

    const from = startOfZonedDay(moment.startKey, timeZone).getTime();
    const to = startOfZonedDay(addDaysToKey(moment.endKey, 1), timeZone).getTime() - 1;
    const covering = campaigns.find((p) => (!p.start || p.start.getTime() <= to) && (p.end as Date).getTime() >= from);

    if (covering) continue;

    const range = moment.startKey === moment.endKey ? formatDay(startOfZonedDay(moment.startKey, timeZone), timeZone) : `${formatShortDay(startOfZonedDay(moment.startKey, timeZone), timeZone)} to ${formatDay(startOfZonedDay(moment.endKey, timeZone), timeZone)}`;

    out.push({
      id: moment.id,
      kind: "season",
      priority: priorityFor(days),
      title: `Plan a ${moment.name} promotion`,
      detail: `Nothing with an end date is scheduled for ${range}. Always-on offers don't count as a campaign.`,
      when: daysLabel(days),
      cta: "Draft this",
      prompt: `Draft a promotion for ${moment.name} (${moment.startKey} to ${moment.endKey}). Suggest a sensible reward, check what else is running or scheduled then, and propose it as a draft.`,
      sortDays: days,
    });
  }

  // 2. Stretches with no store-wide offer.
  for (const gap of gaps) {
    const startKey = zonedDayKey(gap.from, timeZone);
    const endKey = zonedDayKey(gap.to, timeZone);
    const days = Math.max(diffDayKeys(todayKey, startKey), 0);

    out.push({
      id: `gap-${startKey}`,
      kind: "gap",
      priority: gap.days >= 7 ? "medium" : "low",
      title: `${gap.days} days with no store-wide offer`,
      detail: `${formatShortDay(gap.from, timeZone)} to ${formatDay(gap.to, timeZone)}: no automatic promotion is open to every shopper.`,
      when: daysLabel(days),
      cta: "Fill this gap",
      prompt: `There is no store-wide automatic promotion from ${startKey} to ${endKey}. Suggest an offer for that period and draft it, checking for overlaps first.`,
      sortDays: days,
    });
  }

  // 3. Offers that stack with each other.
  const byId = new Map(promotions.map((p) => [p.id, p]));
  const stacking = conflicts
    .filter((c) => c.kind === "stacking")
    .map((c) => ({ conflict: c, a: byId.get(c.promotionIds[0]), b: byId.get(c.promotionIds[1]) }))
    .filter((x): x is { conflict: Conflict; a: CalendarPromotion; b: CalendarPromotion } => Boolean(x.a && x.b) && x.a!.rewardKind !== "shipping" && x.b!.rewardKind !== "shipping")
    .slice(0, 6);

  for (const { a, b } of stacking) {
    out.push({
      id: `stack-${a.id}-${b.id}`,
      kind: "stacking",
      priority: "medium",
      title: `${a.displayName} and ${b.displayName} stack`,
      detail: `${a.discountSummary} and ${b.discountSummary} can both apply to the same order. Check the combined discount is intended.`,
      when: "Active now",
      cta: "Review",
      prompt: `"${a.displayName}" (${a.discountSummary}) and "${b.displayName}" (${b.discountSummary}) overlap and stack. Explain the combined effect for shoppers and suggest whether to stop one stacking. Do not change anything yet.`,
      sortDays: 0,
    });
  }

  // 4. Customer groups with nothing made for them.
  for (const group of groups) {
    const targeted = current.some((p) => p.audience.groupIds.includes(group.id));

    if (targeted) continue;

    out.push({
      id: `audience-${group.id}`,
      kind: "audience",
      priority: "low",
      title: `No offer made for ${group.name}`,
      detail: "They only get store-wide offers. A group-specific reward can build loyalty.",
      when: "Any time",
      cta: "Draft offer",
      prompt: `Draft a promotion for the "${group.name}" customer group only. Suggest a reward that suits them and check overlaps with live offers.`,
      sortDays: 90,
    });
  }

  // 5. Live campaigns about to end.
  for (const p of current) {
    if (!p.end || p.state !== "live") continue;

    const days = diffDayKeys(todayKey, zonedDayKey(p.end, timeZone));

    if (days < 0 || days > 7) continue;

    out.push({
      id: `ending-${p.id}`,
      kind: "ending",
      priority: days <= 2 ? "high" : "medium",
      title: `${p.displayName} ends ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`,
      detail: `${p.discountSummary} stops applying on ${formatDay(p.end, timeZone)}. Extend it or plan a follow-up.`,
      when: daysLabel(days),
      cta: "Plan follow-up",
      prompt: `"${p.displayName}" ends on ${zonedDayKey(p.end, timeZone)}. Suggest whether to extend it or what should follow it, and draft that as a proposal.`,
      sortDays: days,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;

  return out.sort((a, b) => rank[a.priority] - rank[b.priority] || a.sortDays - b.sortDays);
}
