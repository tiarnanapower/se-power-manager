// Server-only: the shared "Big Gear" demo store this app pulls from. Unlike an
// SE's own store (resolved per session through the credentials store), Big
// Gear is one fixed source configured by the operator via env vars.
import "server-only";
import { RestApiClient } from "@/lib/bc-api-client/rest-client/rest-client";
import { AppError } from "@/lib/errors/app-error";

export interface BigGearConfig {
  storeHash: string;
  accessToken: string;
  // Defaults to the store token; set only if B2B uses a different one.
  b2bToken: string;
  // "owner/repo" of the custom B2B Catalyst channel, e.g. "my-org/big-gear-b2b".
  b2bRepo: string | undefined;
  b2bRepoRef: string;
  githubToken: string | undefined;
}

export interface BigGearStatus {
  storeConfigured: boolean;
  repoConfigured: boolean;
  githubTokenConfigured: boolean;
  // Masked, safe to render.
  storeLabel: string;
  repoLabel: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export function getBigGearConfig(): BigGearConfig | undefined {
  const storeHash = clean(process.env.BIG_GEAR_STORE_HASH);
  const accessToken = clean(process.env.BIG_GEAR_ACCESS_TOKEN);

  if (!storeHash || !accessToken) return undefined;

  return {
    storeHash,
    accessToken,
    b2bToken: clean(process.env.BIG_GEAR_B2B_TOKEN) ?? accessToken,
    b2bRepo: clean(process.env.BIG_GEAR_B2B_REPO),
    b2bRepoRef: clean(process.env.BIG_GEAR_B2B_REPO_REF) ?? "main",
    githubToken: clean(process.env.GITHUB_TOKEN),
  };
}

export function getBigGearConfigOrThrow(): BigGearConfig {
  const config = getBigGearConfig();

  if (!config) {
    throw new AppError("VALIDATION", "The Big Gear store isn't configured. Set BIG_GEAR_STORE_HASH and BIG_GEAR_ACCESS_TOKEN on the server.");
  }

  return config;
}

export function getBigGearStatus(): BigGearStatus {
  const config = getBigGearConfig();
  const hash = config?.storeHash;

  return {
    storeConfigured: Boolean(config),
    repoConfigured: Boolean(config?.b2bRepo),
    githubTokenConfigured: Boolean(config?.githubToken),
    storeLabel: hash ? `${hash.slice(0, 3)}${"•".repeat(Math.max(hash.length - 3, 0))}` : "Not configured",
    repoLabel: config?.b2bRepo ?? "Not configured",
  };
}

export function getBigGearRestClient(): RestApiClient {
  const { storeHash, accessToken } = getBigGearConfigOrThrow();

  return new RestApiClient({ storeHash, apiToken: accessToken });
}
