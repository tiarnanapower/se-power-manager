// The three "pull from Big Gear" operations. Signatures and result shapes are
// settled so the UI and activity log can be built against them; the bodies are
// the next phase (see docs/PLAN.md). Every one writes to the SE's own store,
// so each must be called from a Server Action that has passed
// isAuthorizedForStore, and must log to the activity store.
import "server-only";
import { AppError } from "@/lib/errors/app-error";

export interface PullResult {
  created: number;
  skipped: number;
  failed: number;
  messages: string[];
}

export interface ProductPullOptions {
  // Pull everything when omitted.
  categoryIds?: number[];
  limit?: number;
  // Tag created products so "Clear demo products" can find them later.
  tag: string;
}

export interface StencilPullOptions {
  themeUuid: string;
  // Create a new Stencil channel for it, or install into an existing one.
  channelName?: string;
  existingChannelId?: number;
  activate: boolean;
}

export interface B2bPullOptions {
  // Create the Catalyst channel and wire it to the repo.
  createChannel: boolean;
  channelName?: string;
  // Also copy companies, users, company groups and the shared catalogs.
  includeB2bData: boolean;
}

function notBuilt(name: string): never {
  throw new AppError("VALIDATION", `${name} isn't built yet. The connection is ready; the pull itself is the next phase.`);
}

export async function pullProducts(_storeHash: string, _options: ProductPullOptions): Promise<PullResult> {
  return notBuilt("Product import from Big Gear");
}

export async function pullStencilChannel(_storeHash: string, _options: StencilPullOptions): Promise<PullResult> {
  return notBuilt("Stencil channel pull");
}

export async function pullB2bChannel(_storeHash: string, _options: B2bPullOptions): Promise<PullResult> {
  return notBuilt("Custom B2B channel pull");
}
