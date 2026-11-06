// Server-only: signs and verifies draft tokens with the app's own secret.
import "server-only";
import { signPayload, verifyPayload } from "@/lib/copilot/signing";
import type { Draft } from "@/lib/copilot/draft-spec";

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.STATIC_STORE_TOKEN || process.env.PORTKEY_API_KEY;

  if (!value) throw new Error("No server secret is configured to sign copilot drafts.");

  return `copilot-draft:${value}`;
}

export const signDraft = (storeHash: string | undefined, draft: Draft) => signPayload("draft", storeHash, draft, secret());
export const verifyDraft = (token: unknown, storeHash: string | undefined, draft: Draft) => verifyPayload(token, "draft", storeHash, draft, secret());
export const signEnable = (storeHash: string | undefined, promotionId: number) => signPayload("enable", storeHash, promotionId, secret());
export const verifyEnable = (token: unknown, storeHash: string | undefined, promotionId: number) => verifyPayload(token, "enable", storeHash, promotionId, secret());
