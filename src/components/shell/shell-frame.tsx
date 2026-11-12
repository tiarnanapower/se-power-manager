"use client";

import { Suspense } from "react";
import { JobDock } from "@/components/jobs/job-dock";
import { HeaderTitle } from "@/components/shell/header-title";
import { MenuIcon } from "@/components/shell/icons";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { useMediaQuery, usePreferences } from "@/lib/use-preferences";

// Client frame: sidebar and header. `banner` and `modeLabel` are rendered on
// the server and passed in. Components that read route params sit in their own
// Suspense boundaries so the chrome paints immediately.
export function ShellFrame({ children, banner, modeLabel }: { children: React.ReactNode; banner: React.ReactNode; modeLabel: string }) {
  const [preferences, setPreferences] = usePreferences();
  // The control panel gives apps a narrow frame, so the sidebar minimises itself there.
  const narrow = useMediaQuery("(max-width: 900px)");
  const collapsed = preferences.sidebarCollapsed || narrow;

  return (
    <div className="pp-frame">
      <aside className={collapsed ? "pp-sidebar is-collapsed" : "pp-sidebar"} aria-label="Sidebar">
        <Suspense>
          <SidebarNav collapsed={collapsed} />
        </Suspense>
      </aside>
      <div className="pp-main">
        <header className="pp-header">
          <button type="button" className="pp-btn pp-btn--icon" aria-label={collapsed ? "Expand menu" : "Minimise menu"} aria-pressed={collapsed} disabled={narrow} hidden={narrow} onClick={() => setPreferences({ ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed })}>
            <MenuIcon size={18} />
          </button>
          <Suspense fallback={<span className="pp-header__spacer" />}>
            <HeaderTitle modeLabel={modeLabel} />
          </Suspense>
        </header>
        <div className="pp-content">
          <main className="pp-page">
            {banner}
            {children}
          </main>
        </div>
      </div>
      <JobDock />
    </div>
  );
}
