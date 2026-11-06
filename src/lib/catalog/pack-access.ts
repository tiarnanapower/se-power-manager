// Who may touch a pack. Packs are private to the store that saved them until they are
// published to the Shared Catalog; then any store can restore from them, but only the
// owner can change or remove them. A pack nobody may see is reported as missing, so its
// existence isn't revealed.
import type { PackSummary } from "@/lib/app-data/types";
import { AppError } from "@/lib/errors/app-error";

export const effectiveStoreHash = (storeHash: string | undefined): string => storeHash ?? process.env.STATIC_STORE_HASH ?? "static";

export const ownsPack = (pack: PackSummary, storeHash: string): boolean => pack.storeHash === storeHash;

export const canUsePack = (pack: PackSummary, storeHash: string): boolean => ownsPack(pack, storeHash) || pack.publishedAt !== null;

const missing = () => new AppError("NOT_FOUND", "That pack no longer exists.", { detail: "That pack no longer exists." });

// For reading or restoring from a pack.
export function assertCanUse(pack: PackSummary, storeHash: string): void {
  if (!canUsePack(pack, storeHash)) throw missing();
}

// For changing, deleting, publishing or copying images of a pack.
export function assertOwns(pack: PackSummary, storeHash: string): void {
  if (!ownsPack(pack, storeHash)) {
    if (canUsePack(pack, storeHash)) throw new AppError("AUTH", "Only the store that saved this pack can change it.", { detail: "Only the store that saved this pack can change it." });

    throw missing();
  }
}
