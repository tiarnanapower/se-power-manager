// Single source of truth for the sidebar, header titles and route stubs.
// `path` is relative to the app root: "/store/<hash>/<path>" when installed,
// "/<path>" on the root-level dev aliases.

export type NavIcon = "catalog" | "store" | "health" | "activity" | "settings";

export interface NavItem {
  id: string;
  title: string;
  path: string;
  // One-line description shown at the top of the page.
  description: string;
}

export interface NavGroup {
  id: string;
  title: string;
  icon: NavIcon;
  // Single-page groups (Store Health, Activity) render as a plain link.
  items: NavItem[];
  placement: "main" | "system";
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "catalog",
    title: "Catalog",
    icon: "catalog",
    placement: "main",
    items: [
      { id: "sample-catalog", title: "Sample Catalog", path: "catalog/samples", description: "Ready-made sample data for your sandbox: catalog, shipping, tax, pricing and more, versioned in GitHub." },
      { id: "import", title: "Import Tool", path: "catalog/import", description: "Point at a customer site and let AI scrape the products, then review and push them to your store." },
      { id: "enrich", title: "Enrich Tool", path: "catalog/enrich", description: "Improve descriptions, SEO and attributes on products already in your store." },
      { id: "restore", title: "Restore & Clear", path: "catalog/restore", description: "Save your catalog as a pack, restore one, or clear products in bulk." },
    ],
  },
  {
    id: "big-gear",
    title: "Big Gear",
    icon: "store",
    placement: "main",
    items: [
      { id: "big-gear-products", title: "Product Import", path: "big-gear/products", description: "Copy products from the Big Gear demo store into your store." },
      { id: "big-gear-stencil", title: "Stencil Channel Pull", path: "big-gear/stencil", description: "Pull the Big Gear Stencil channel theme into your store." },
      { id: "big-gear-b2b", title: "Custom B2B Channel Pull", path: "big-gear/b2b", description: "Pull the custom B2B Catalyst channel, and optionally the Big Gear B2B data." },
    ],
  },
  {
    id: "store-health",
    title: "Store Health",
    icon: "health",
    placement: "main",
    items: [{ id: "store-health", title: "Store Health", path: "store-health", description: "Spot products with missing images, descriptions, stock or channel assignments." }],
  },
  {
    id: "activity",
    title: "Activity",
    icon: "activity",
    placement: "main",
    items: [{ id: "activity", title: "Activity", path: "activity", description: "Everything this app has changed in your store, with undo where possible." }],
  },
  {
    id: "settings",
    title: "Settings",
    icon: "settings",
    placement: "system",
    items: [{ id: "settings", title: "Settings", path: "settings", description: "Connections, API scopes and AI configuration." }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const DEFAULT_PATH = "catalog/samples";

// A store-scoped pathname is "/store/<hash>/<path>"; a root-level dev path is
// "/<path>". Returns the matching nav item, if any.
export function getActiveItem(pathname: string, storeHash: string | undefined): NavItem | undefined {
  const segments = pathname.split("/").filter(Boolean);
  const rest = (storeHash ? segments.slice(2) : segments).join("/");

  const path = rest || DEFAULT_PATH;

  // A sample's own page (catalog/samples/<name>) belongs to the Sample Catalog item.
  return NAV_ITEMS.find((item) => item.path === path) ?? NAV_ITEMS.find((item) => path.startsWith(`${item.path}/`));
}
