import { Message } from "@bigcommerce/big-design";
import { CalendarView } from "@/components/calendar/calendar-view";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { type CalendarData, loadCalendar } from "@/lib/promo-calendar/load-calendar";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

const LOAD_FAILURE = "BigCommerce didn't return your promotions. Check the store credentials and that the token has the Marketing scope.";

export async function CalendarPage({ params }: PageProps) {
  const resolved = await params;
  const raw = resolved.storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let data: CalendarData | undefined;
  let failure: string | undefined;

  try {
    data = await loadCalendar(storeHash);
  } catch (error) {
    logError("CalendarPage", error);
    failure = toSafeMessage(error, LOAD_FAILURE);
  }

  return data ? (
    <CalendarView {...data} />
  ) : (
    <Message type="error" header="Couldn't load promotions" messages={[{ text: failure ?? LOAD_FAILURE }]} />
  );
}
