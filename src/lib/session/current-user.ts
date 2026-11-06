import "server-only";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { readSession } from "@/lib/session/session-cookie";

// The email of the BigCommerce user driving this request, for attributing packs
// and activity. Undefined in MOCK/STATIC (no session) or if it can't be read;
// attribution is best-effort and must never block the action it labels.
export async function getCurrentUserEmail(): Promise<string | undefined> {
  if (getDataMode() !== "MULTITENANT") return undefined;

  try {
    const session = await readSession();

    return session ? await getCredentialsStore().getUserEmail(session.userId) : undefined;
  } catch (error) {
    logError("getCurrentUserEmail", error);

    return undefined;
  }
}
