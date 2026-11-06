"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { BoxIcon, ClockIcon, PulseIcon, SettingsIcon, StoreIcon } from "@/components/shell/icons";
import { BRAND } from "@/components/shell/brand";
import { getActiveItem, NAV_GROUPS, type NavGroup, type NavIcon } from "@/components/shell/nav-items";
import { getAppUrl } from "@/lib/routing/app-url";

const ICONS: Record<NavIcon, () => React.ReactNode> = {
  catalog: () => <BoxIcon />,
  store: () => <StoreIcon />,
  health: () => <PulseIcon />,
  activity: () => <ClockIcon />,
  settings: () => <SettingsIcon />,
};

export function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const params = useParams<{ storeHash?: string }>();
  const storeHash = params.storeHash;
  const active = getActiveItem(usePathname(), storeHash);

  const renderGroup = (group: NavGroup) => {
    const single = group.items.length === 1;

    // Minimised: one icon per group, linking to its first page.
    if (collapsed) {
      const first = group.items[0];
      const isActive = group.items.some((item) => item.id === active?.id);

      return (
        <Link key={group.id} className="pp-nav__item pp-nav__item--rail" href={getAppUrl(storeHash, `/${first.path}`)} aria-current={isActive ? "page" : undefined} aria-label={group.title} title={group.title}>
          {ICONS[group.icon]()}
        </Link>
      );
    }

    return (
      <div key={group.id} className="pp-nav__group">
        {single ? null : (
          <div className="pp-nav__heading">
            {ICONS[group.icon]()}
            <span className="pp-nav__text">{group.title}</span>
          </div>
        )}
        {group.items.map((item) => (
          <Link
            key={item.id}
            className={single ? "pp-nav__item" : "pp-nav__item pp-nav__item--sub"}
            href={getAppUrl(storeHash, `/${item.path}`)}
            aria-current={item.id === active?.id ? "page" : undefined}
          >
            {single ? ICONS[group.icon]() : null}
            <span className="pp-nav__text">{item.title}</span>
          </Link>
        ))}
      </div>
    );
  };

  return (
    <>
      <Link href={getAppUrl(storeHash, "/")} className="pp-brand" aria-label={BRAND.fullName}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pp-brand__logo" src="/brand/icon.svg" alt="" width={36} height={36} />
        <span className="pp-brand__text">
          <span className="pp-brand__name">{BRAND.name}</span>
          <br />
          <span className="pp-brand__sub">{BRAND.tagline}</span>
        </span>
      </Link>
      <nav className="pp-nav" aria-label="Main">
        {NAV_GROUPS.filter((group) => group.placement === "main").map(renderGroup)}
        {!collapsed && <div className="pp-nav__label">System</div>}
        {NAV_GROUPS.filter((group) => group.placement === "system").map(renderGroup)}
      </nav>
    </>
  );
}
