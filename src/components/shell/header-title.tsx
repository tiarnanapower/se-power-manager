"use client";

import { useParams, usePathname } from "next/navigation";
import { getActiveSection, NAV_ITEMS } from "@/components/shell/nav-items";

const TITLES: Record<string, string> = {
  calendar: "Promotion calendar",
  promotions: "Promotions",
  audiences: "Audiences",
  recommendations: "Recommendations",
  settings: "Settings",
};

// Reads route params client-side, so under cacheComponents it must sit inside
// its own Suspense boundary (see ShellFrame).
export function HeaderTitle({ modeLabel }: { modeLabel: string }) {
  const params = useParams<{ storeHash?: string }>();
  const section = getActiveSection(usePathname(), params.storeHash);
  const title = (section && TITLES[section]) ?? NAV_ITEMS[0].title;

  return (
    <>
      <h1 className="pp-header__title">{title}</h1>
      <span className="pp-header__spacer" />
      <span className="pp-store-chip"><span className="pp-dot" />{params.storeHash ? `Store ${params.storeHash}` : modeLabel}</span>
    </>
  );
}
