// Server-only: the shared source store Wawaweewa copies from. Like Big Gear, it is one fixed store set by
// the operator in the environment, so SEs never see or handle its token. The same token reaches the
// store's B2B Edition API.
import "server-only";
import { B2B_API_BASE } from "@/lib/bc-api-client/b2b-client";
import { RestApiClient } from "@/lib/bc-api-client/rest-client/rest-client";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { AppError } from "@/lib/errors/app-error";

export const WAWAWEEWA_VARS = ["WAWAWEEWA_STORE_HASH", "WAWAWEEWA_ACCESS_TOKEN"];

const clean = (value: string | undefined): string | undefined => value?.trim() || undefined;

export function getWawaweewaConfig(): { storeHash: string; accessToken: string } | undefined {
  const storeHash = clean(process.env.WAWAWEEWA_STORE_HASH);
  const accessToken = clean(process.env.WAWAWEEWA_ACCESS_TOKEN);

  return storeHash && accessToken ? { storeHash, accessToken } : undefined;
}

export function getWawaweewaStatus(): { configured: boolean; label: string } {
  const hash = getWawaweewaConfig()?.storeHash;

  return { configured: Boolean(hash), label: hash ? `${hash.slice(0, 3)}${"•".repeat(Math.max(hash.length - 3, 0))}` : "Not configured" };
}

function configOrThrow() {
  const config = getWawaweewaConfig();

  if (!config) throw new AppError("VALIDATION", "The source store isn't configured. Set WAWAWEEWA_STORE_HASH and WAWAWEEWA_ACCESS_TOKEN on the server.", { detail: "The source store isn't configured. Set WAWAWEEWA_STORE_HASH and WAWAWEEWA_ACCESS_TOKEN on the server." });

  return config;
}

// Both clients only ever read from the source store.
export function getWawaweewaClient(): BcRestApiClient {
  const { storeHash, accessToken } = configOrThrow();

  return new RestApiClient({ storeHash, apiToken: accessToken });
}

export function getWawaweewaB2bClient(): BcRestApiClient {
  const { storeHash, accessToken } = configOrThrow();

  return new RestApiClient({ storeHash, apiToken: accessToken }, B2B_API_BASE);
}
