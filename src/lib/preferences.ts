// Per-browser UI preferences. Stored in localStorage purely as a convenience:
// every read and write is wrapped because storage can be unavailable (private
// windows, blocked cookies, iframes), and the UI works with the defaults.
export interface Preferences {
  // Icon-only sidebar.
  sidebarCollapsed: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { sidebarCollapsed: false };

export const PREFERENCES_KEY = "se-power-manager:preferences:v1";

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;

    return { sidebarCollapsed: parsed.sidebarCollapsed === true };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage unavailable: preferences simply don't persist.
  }
}
