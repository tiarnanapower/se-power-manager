"use client";

import { useParams, usePathname } from "next/navigation";
import { getActiveItem, NAV_ITEMS } from "@/components/shell/nav-items";

// Reads route params client-side, so under cacheComponents it must sit inside
// its own Suspense boundary (see ShellFrame).
export function HeaderTitle({ modeLabel }: { modeLabel: string }) {
  const params = useParams<{ storeHash?: string }>();
  const item = getActiveItem(usePathname(), params.storeHash) ?? NAV_ITEMS[0];

  return (
    <>
      <h1 className="pp-header__title">{item.title}</h1>
      <span className="pp-header__spacer" />
      <span className="pp-store-chip"><span className="pp-dot" />{params.storeHash ? `Store ${params.storeHash}` : modeLabel}</span>
    </>
  );
}
