import "server-only";
import { resolveApiToken, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { RestApiClient } from "@/lib/bc-api-client/rest-client/rest-client";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

// The B2B Edition management API. It lives on its own host and takes the store's usual API token.
export const B2B_API_BASE = "https://api-b2b.bigcommerce.com/api/v3/io";

export async function getB2bClient(storeHash: string | undefined): Promise<BcRestApiClient> {
  const hash = resolveStoreHash(storeHash);

  return new RestApiClient({ storeHash: hash, apiToken: await resolveApiToken(hash) }, B2B_API_BASE);
}
