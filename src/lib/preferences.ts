// Per-browser UI preferences. Stored in localStorage purely as a convenience:
// every read and write is wrapped because storage can be unavailable (private
// windows, blocked cookies, iframes), and the UI works with the defaults.
export type CalendarViewKey = "month" | "week" | "quarter" | "timeline";

export interface Preferences {
  defaultView: CalendarViewKey;
  weekStartsOn: 0 | 1;
  showAlwaysOn: boolean;
  sidebarHidden: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { defaultView: "month", weekStartsOn: 0, showAlwaysOn: true, sidebarHidden: false };

export const PREFERENCES_KEY = "power-promotions:preferences:v1";
const VIEWS: CalendarViewKey[] = ["month", "week", "quarter", "timeline"];

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;

    return {
      defaultView: VIEWS.includes(parsed.defaultView as CalendarViewKey) ? (parsed.defaultView as CalendarViewKey) : DEFAULT_PREFERENCES.defaultView,
      weekStartsOn: parsed.weekStartsOn === 1 ? 1 : 0,
      showAlwaysOn: parsed.showAlwaysOn !== false,
      sidebarHidden: parsed.sidebarHidden === true,
    };
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
