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

// Always shown on the page: enough to tell which token the server has, never enough to use it.
export function getWawaweewaTokenHint(): string | undefined {
  const config = getWawaweewaConfig();

  if (!config) return undefined;

  const { accessToken: token, storeHash: hash } = config;

  return `The token the server is using starts with "${token.slice(0, 4)}" and is ${token.length} characters long. The store hash starts with "${hash.slice(0, 3)}", ends with "${hash.slice(-3)}" and is ${hash.length} characters long.`;
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

export interface B2bProbe {
  label: string;
  status: number | string;
  contentType: string;
  body: string;
}

// One-off diagnostic: calls B2B Edition from the server a few ways and reports what came back. Nothing secret
// is returned, only the response (a company list is cut to its first characters).
export async function probeB2b(): Promise<B2bProbe[]> {
  const { storeHash, accessToken } = configOrThrow();
  const url = `${B2B_API_BASE}/companies?limit=1&offset=0`;
  const auth = { "X-Auth-Token": accessToken, "X-Store-Hash": storeHash };
  const variants: [string, Record<string, string>][] = [
    ["Same headers as the app", { ...auth, Accept: "application/json" }],
    ["Auth headers only", auth],
    ["Auth headers with a browser-style user agent", { ...auth, "User-Agent": "curl/8.7.1", Accept: "*/*" }],
  ];

  return Promise.all(variants.map(async ([label, headers]): Promise<B2bProbe> => {
    try {
      const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = (await response.text()).replace(accessToken, "[token]").slice(0, 160);

      return { label, status: response.status, contentType: response.headers.get("content-type") ?? "", body };
    } catch (error) {
      return { label, status: "no answer", contentType: "", body: error instanceof Error ? error.message.slice(0, 160) : "Request failed." };
    }
  }));
}
