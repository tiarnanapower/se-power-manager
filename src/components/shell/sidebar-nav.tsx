"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { BoxIcon, ClockIcon, PulseIcon, SettingsIcon, StoreIcon, TerminalIcon } from "@/components/shell/icons";
import { BRAND } from "@/components/shell/brand";
import { getActiveItem, NAV_GROUPS, type NavGroup, type NavIcon } from "@/components/shell/nav-items";
import { getAppUrl } from "@/lib/routing/app-url";

const ICONS: Record<NavIcon, () => React.ReactNode> = {
  catalog: () => <BoxIcon />,
  store: () => <StoreIcon />,
  health: () => <PulseIcon />,
  activity: () => <ClockIcon />,
  settings: () => <SettingsIcon />,
  terminal: () => <TerminalIcon />,
};

export function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const params = useParams<{ storeHash?: string }>();
  const storeHash = params.storeHash;
  const active = getActiveItem(usePathname(), storeHash);
  const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.id === active?.id))?.id;
  // Groups with several pages drop down when their heading is clicked. The group you are in is open
  // by default, and opens again whenever you navigate into it.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState(activeGroup);

  if (activeGroup !== seen) {
    setSeen(activeGroup);
    if (activeGroup) setToggled((current) => ({ ...current, [activeGroup]: true }));
  }

  const isOpen = (group: NavGroup) => toggled[group.id] ?? group.id === activeGroup;

  const renderGroup = (group: NavGroup) => {
    const single = group.items.length === 1 && !group.menu;

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

    const open = single || isOpen(group);

    return (
      <div key={group.id} className="pp-nav__group">
        {single ? null : (
          <button type="button" className="pp-nav__heading pp-nav__toggle" aria-expanded={open} onClick={() => setToggled((current) => ({ ...current, [group.id]: !open }))}>
            {ICONS[group.icon]()}
            <span className="pp-nav__text">{group.title}</span>
            <svg className="pp-nav__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
        {open && group.items.map((item) => (
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
        {NAV_GROUPS.filter((group) => group.placement === "main" && !group.hidden).map(renderGroup)}
        {!collapsed && <div className="pp-nav__label">System</div>}
        {NAV_GROUPS.filter((group) => group.placement === "system").map(renderGroup)}
      </nav>
    </>
  );
}
