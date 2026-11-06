// Server-only: uses the store API token.
import "server-only";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";

export interface CustomerGroup {
  id: number;
  name: string;
}

const CUSTOMER_GROUPS_PATH = "/v2/customer_groups";
const MAX_GROUPS = 250;

// The v2 endpoint returns a bare array (or 204 with no body when there are no
// groups) and needs the Customers: read-only scope.
export async function fetchCustomerGroups(storeHash: string | undefined): Promise<CustomerGroup[]> {
  const apiClient = await getRestApiClient(storeHash);
  const { data } = await apiClient.get<CustomerGroup[] | undefined>(CUSTOMER_GROUPS_PATH, {
    params: { limit: MAX_GROUPS },
  });

  return (data ?? []).map((group) => ({ id: group.id, name: group.name }));
}
