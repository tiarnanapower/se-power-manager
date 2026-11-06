import { Message } from "@bigcommerce/big-design";
import { AudiencesView } from "@/components/audiences/audiences-view";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { type CalendarData, loadAudiences } from "@/lib/promo-calendar/load-calendar";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

const LOAD_FAILURE = "BigCommerce didn't return your promotions. Check the store credentials and that the token has the Marketing scope.";

export async function AudiencesPage({ params }: PageProps) {
  const resolved = await params;
  const raw = resolved.storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  let data: CalendarData | undefined;
  let failure: string | undefined;

  try {
    data = await loadAudiences(storeHash);
  } catch (error) {
    logError("AudiencesPage", error);
    failure = toSafeMessage(error, LOAD_FAILURE);
  }

  return data ? (
    <AudiencesView promotions={data.promotions} conflicts={data.conflicts} groups={data.groups} channels={data.channels} segments={data.segmentItems} segmentsNote={data.segmentsNote} timeZone={data.timeZone} currencySymbol={data.currencySymbol} />
  ) : (
    <Message type="error" header="Couldn't load promotions" messages={[{ text: failure ?? LOAD_FAILURE }]} />
  );
}
