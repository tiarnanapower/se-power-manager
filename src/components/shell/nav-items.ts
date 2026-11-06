export interface NavItem {
  id: string;
  title: string;
  icon: "calendar" | "promotions" | "audiences" | "recommendations" | "settings";
  // Section appears in the nav but its page isn't built yet.
  soon?: boolean;
  // Served at the app root as well as under its own path.
  isIndex?: boolean;
  group: "main" | "system";
}

export const NAV_ITEMS: NavItem[] = [
  { id: "calendar", title: "Calendar", icon: "calendar", isIndex: true, group: "main" },
  { id: "promotions", title: "Promotions", icon: "promotions", group: "main" },
  { id: "audiences", title: "Audiences", icon: "audiences", group: "main" },
  { id: "recommendations", title: "Recommendations", icon: "recommendations", group: "main" },
  { id: "settings", title: "Settings", icon: "settings", group: "system" },
];

// A store-scoped path is "/store/<hash>/<section>"; a root-level dev path has
// its section first. No section segment means the index route.
export function getActiveSection(pathname: string, storeHash: string | undefined): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  const section = storeHash ? segments[2] : segments[0];

  if (!section) return NAV_ITEMS.find((item) => item.isIndex)?.id;

  return NAV_ITEMS.some((item) => item.id === section) ? section : undefined;
}
