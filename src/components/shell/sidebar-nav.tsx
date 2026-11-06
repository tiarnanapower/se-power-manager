"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CalendarIcon, SettingsIcon, TagIcon, TrendIcon, UsersIcon } from "@/components/shell/icons";
import { BRAND } from "@/components/shell/brand";
import { getActiveSection, NAV_ITEMS, type NavItem } from "@/components/shell/nav-items";
import { getAppUrl } from "@/lib/routing/app-url";

const ICONS: Record<NavItem["icon"], () => React.ReactNode> = {
  calendar: () => <CalendarIcon />,
  promotions: () => <TagIcon />,
  audiences: () => <UsersIcon />,
  recommendations: () => <TrendIcon />,
  settings: () => <SettingsIcon />,
};

export function SidebarNav() {
  const params = useParams<{ storeHash?: string }>();
  const storeHash = params.storeHash;
  const active = getActiveSection(usePathname(), storeHash);

  const renderItem = (item: NavItem) => {
    const content = (
      <>
        {ICONS[item.icon]()}
        <span className="pp-nav__text">{item.title}</span>
        {item.soon && <span className="pp-nav__soon">Soon</span>}
      </>
    );

    if (item.soon) {
      return (
        <div key={item.id} className="pp-nav__item" aria-disabled="true" title={`${item.title} is coming soon`}>
          {content}
        </div>
      );
    }

    return (
      <Link key={item.id} className="pp-nav__item" href={getAppUrl(storeHash, item.isIndex ? "/" : `/${item.id}`)} aria-current={item.id === active ? "page" : undefined}>
        {content}
      </Link>
    );
  };

  return (
    <>
      <Link href={getAppUrl(storeHash, "/")} className="pp-brand" aria-label={BRAND.fullName}>
        <span className="pp-brand__mark"><TagIcon size={18} /></span>
        <span className="pp-brand__text">
          <span className="pp-brand__name">{BRAND.name}</span>
          <br />
          <span className="pp-brand__sub">{BRAND.tagline}</span>
        </span>
      </Link>
      <nav className="pp-nav" aria-label="Main">
        <div className="pp-nav__label">Plan</div>
        {NAV_ITEMS.filter((item) => item.group === "main").map(renderItem)}
        <div className="pp-nav__label">System</div>
        {NAV_ITEMS.filter((item) => item.group === "system").map(renderItem)}
      </nav>
    </>
  );
}
