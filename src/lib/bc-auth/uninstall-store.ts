import { parseStoreHash, verifySignedPayload } from "@/lib/bc-auth/verify-signed-payload";
import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";

// Verifies the /uninstall callback's signed request and deletes everything
// stored for that store, rather than leaving stale rows behind.
export async function uninstallStore(signedPayloadJwt: string): Promise<void> {
  const payload = await verifySignedPayload(signedPayloadJwt);
  const storeHash = parseStoreHash(payload.sub);

  await getCredentialsStore().deleteStore(storeHash);

  // Drop this store's demo-product records and activity too. Best effort: the
  // credentials are already gone, so a failure here must not fail the uninstall.
  try {
    await getAppDataStore().deleteStoreData(storeHash);
  } catch (error) {
    logError("uninstallStore: deleteStoreData", error);
  }
}
