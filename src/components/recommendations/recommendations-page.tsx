import { Message } from "@bigcommerce/big-design";
import { RecommendationsView } from "@/components/recommendations/recommendations-view";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { type CalendarData, loadCalendar } from "@/lib/promo-calendar/load-calendar";
import { buildRecommendations } from "@/lib/promo-calendar/recommendations";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

const LOAD_FAILURE = "BigCommerce didn't return your promotions. Check the store credentials and that the token has the Marketing scope.";

export async function RecommendationsPage({ params }: PageProps) {
  const resolved = await params;
  const raw = resolved.storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let data: CalendarData | undefined;
  let failure: string | undefined;

  try {
    data = await loadCalendar(storeHash);
  } catch (error) {
    logError("RecommendationsPage", error);
    failure = toSafeMessage(error, LOAD_FAILURE);
  }

  return data ? (
    <RecommendationsView recommendations={buildRecommendations({ promotions: data.promotions, conflicts: data.conflicts, gaps: data.gaps, groups: data.groups, now: new Date(data.nowIso), timeZone: data.timeZone })} />
  ) : (
    <Message type="error" header="Couldn't load promotions" messages={[{ text: failure ?? LOAD_FAILURE }]} />
  );
}
