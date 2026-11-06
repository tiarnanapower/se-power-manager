// Server-only: loads everything the calendar and list pages need in one place.
import "server-only";
import { fetchCustomerGroups } from "@/lib/audiences/customer-groups-api";
import { fetchMemberCounts, fetchSegments } from "@/lib/audiences/segments-api";
import { fetchChannels } from "@/lib/channels/channels-api";
import { logError } from "@/lib/errors/logger";
import { findConflicts } from "@/lib/promo-calendar/conflicts";
import { addUtcDays } from "@/lib/promo-calendar/dates";
import { toCalendarPromotions } from "@/lib/promo-calendar/from-promotion";
import { findCoverageGaps } from "@/lib/promo-calendar/gaps";
import { fetchAllPromotions } from "@/lib/promotions/promotions-api";
import { fetchStoreInfo } from "@/lib/store/store-info-api";

const GAP_LOOKAHEAD_DAYS = 90;

// Groups and channels only add names to the UI, so a failure there (for
// example a token without the Customers scope) degrades to ids instead of
// failing the whole page.
async function optional<T>(label: string, load: Promise<T>, fallback: T): Promise<T> {
  try {
    return await load;
  } catch (error) {
    logError(`loadCalendar: ${label}`, error);

    return fallback;
  }
}

export async function loadCalendar(storeHash: string | undefined) {
  const [promotions, groups, channels, storeInfo, segmentsResult] = await Promise.all([
    fetchAllPromotions(storeHash),
    optional("customer groups", fetchCustomerGroups(storeHash), []),
    optional("channels", fetchChannels(storeHash), { items: [] }),
    fetchStoreInfo(storeHash),
    fetchSegments(storeHash),
  ]);
  const now = new Date();
  const items = toCalendarPromotions(promotions, now);

  return {
    promotions: items,
    conflicts: findConflicts(items),
    gaps: findCoverageGaps(items, now, addUtcDays(now, GAP_LOOKAHEAD_DAYS), 3, storeInfo.timeZone),
    groups,
    // Light list (names only) so promotions can say which segment they target.
    segments: segmentsResult.available ? segmentsResult.items.map((segment) => ({ id: segment.id, name: segment.name })) : [],
    segmentsNote: segmentsResult.available ? null : segmentsResult.message,
    segmentItems: segmentsResult.available ? segmentsResult.items : [],
    channels: channels.items.map((channel) => ({ id: channel.id, name: channel.name })),
    nowIso: now.toISOString(),
    timeZone: storeInfo.timeZone,
    currencySymbol: storeInfo.currencySymbol,
    timeZoneFromStore: storeInfo.fromStore,
    storeName: storeInfo.name,
  };
}

// The Audiences page also wants member counts for each segment.
export async function loadAudiences(storeHash: string | undefined) {
  const data = await loadCalendar(storeHash);

  try {
    return { ...data, segmentItems: data.segmentItems.length > 0 ? await fetchMemberCounts(storeHash, data.segmentItems) : data.segmentItems };
  } catch (error) {
    logError("loadAudiences: member counts", error);

    return data;
  }
}

export type CalendarData = Awaited<ReturnType<typeof loadCalendar>>;
