"use client";

// The Enrich screens were written against fetch() routes. This binds the
// equivalent server actions to the current store, so the screens only call
// `useEnrichApi()`.
import { createContext, useContext, useMemo } from "react";
import {
  analyzeFilesAction,
  analyzeTextAction,
  applyActionAction,
  clearQueueAction,
  editActionAction,
  getActionAction,
  getJobsAction,
  getQueueAction,
  getStoreInfoAction,
  searchProductsAction,
  setStatusAction,
} from "@/app/store/[storeHash]/catalog/enrich/actions";

const StoreContext = createContext<string | undefined>(undefined);

export function EnrichProvider({ storeHash, children }: { storeHash: string | undefined; children: React.ReactNode }) {
  return <StoreContext.Provider value={storeHash}>{children}</StoreContext.Provider>;
}

export function useStoreHash(): string | undefined {
  return useContext(StoreContext);
}

/** URL of an uploaded packshot, served by /api/enrich-upload. */
export function uploadUrl(storeHash: string | undefined, key: string): string {
  return `/api/enrich-upload?key=${encodeURIComponent(key)}${storeHash ? `&s=${encodeURIComponent(storeHash)}` : ""}`;
}

export function useEnrichApi() {
  const storeHash = useStoreHash();

  return useMemo(
    () => ({
      storeHash,
      queue: (status: string) => getQueueAction(storeHash, { status }),
      jobs: (ids: string[]) => getJobsAction(storeHash, { ids }),
      action: (id: string) => getActionAction(storeHash, { id }),
      edit: (id: string, edit: Record<string, unknown>) => editActionAction(storeHash, { id, edit }),
      apply: (id: string) => applyActionAction(storeHash, { id }),
      cancel: (ids: string[]) => setStatusAction(storeHash, { ids, status: "cancelled" }),
      clear: () => clearQueueAction(storeHash),
      search: (q: string) => searchProductsAction(storeHash, { q }),
      info: () => getStoreInfoAction(storeHash),
      analyzeFiles: (files: File[]) => {
        const body = new FormData();

        files.forEach((file) => body.append("files", file));

        return analyzeFilesAction(storeHash, body);
      },
      analyzeText: (text: string) => analyzeTextAction(storeHash, { text }),
    }),
    [storeHash],
  );
}
