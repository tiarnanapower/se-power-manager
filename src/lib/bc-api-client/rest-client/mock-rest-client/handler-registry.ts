import { channelsMockHandlers } from "@/lib/channels/mock/handlers";
import { MockRouteHandler } from "@/lib/bc-api-client/rest-client/mock-rest-client/types";

// The only place that wires a feature's mock handlers into MockRestApiClient.
// Demo-mode handlers for promotions, customer groups and catalog data are
// registered here as those features land — MockRestApiClient itself never
// needs to change.
export const mockRouteHandlers: MockRouteHandler[] = [...channelsMockHandlers];
