"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCES_KEY, type Preferences, savePreferences } from "@/lib/preferences";

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);

  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFERENCES_KEY);
  } catch {
    return null;
  }
}

// Preferences from localStorage, with defaults on the server and before
// hydration (so server and client first renders agree).
export function usePreferences(): [Preferences, (next: Preferences) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const preferences = useMemo(() => parsePreferences(raw), [raw]);
  const update = useCallback((next: Preferences) => {
    savePreferences(next);
    listeners.forEach((listener) => listener());
  }, []);

  return [raw === null ? DEFAULT_PREFERENCES : preferences, update];
}

// True once the component is running in the browser.
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
