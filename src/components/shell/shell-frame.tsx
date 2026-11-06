"use client";

import { Suspense, useMemo, useState } from "react";
import { CopilotContext } from "@/components/shell/copilot-context";
import { CopilotDock } from "@/components/shell/copilot-dock";
import { HeaderTitle } from "@/components/shell/header-title";
import { ChatIcon, ExternalIcon, MenuIcon, PlusIcon } from "@/components/shell/icons";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { usePreferences } from "@/lib/use-preferences";

// Client frame: sidebar, header and the docked copilot. `banner` and
// `modeLabel` are rendered on the server and passed in. Components that read
// route params sit in their own Suspense boundaries so the chrome paints
// immediately.
export function ShellFrame({ children, banner, modeLabel, copilotConfigured }: { children: React.ReactNode; banner: React.ReactNode; modeLabel: string; copilotConfigured: boolean }) {
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [preferences, setPreferences] = usePreferences();
  const [seed, setSeed] = useState<{ text: string; send: boolean; nonce: number } | undefined>();
  const api = useMemo(
    () => ({
      ask: (prompt: string, options?: { send?: boolean }) => {
        setSeed((current) => ({ text: prompt, send: options?.send ?? true, nonce: (current?.nonce ?? 0) + 1 }));
        setCopilotOpen(true);
      },
    }),
    [],
  );

  return (
    <CopilotContext.Provider value={api}>
    <div className="pp-frame">
      <aside className="pp-sidebar" aria-label="Sidebar" hidden={preferences.sidebarHidden}>
        <Suspense>
          <SidebarNav />
        </Suspense>
      </aside>
      <div className="pp-main">
        <header className="pp-header">
          <button type="button" className="pp-btn pp-btn--icon" aria-label={preferences.sidebarHidden ? "Show menu" : "Hide menu"} aria-pressed={!preferences.sidebarHidden} onClick={() => setPreferences({ ...preferences, sidebarHidden: !preferences.sidebarHidden })}>
            <MenuIcon size={18} />
          </button>
          <Suspense fallback={<span className="pp-header__spacer" />}>
            <HeaderTitle modeLabel={modeLabel} />
          </Suspense>
          <button type="button" className="pp-btn" aria-pressed={copilotOpen} onClick={() => setCopilotOpen((open) => !open)}>
            <ChatIcon size={16} /> Copilot
          </button>
          <a className="pp-btn pp-btn--primary" href="https://login.bigcommerce.com/deep-links/manage/promotions" target="_blank" rel="noopener noreferrer" title="Opens Marketing > Promotions in your BigCommerce control panel">
            <PlusIcon size={16} /> New promotion <ExternalIcon size={14} />
          </a>
        </header>
        <div className="pp-content">
          <main className="pp-page">
            {banner}
            {children}
          </main>
          {copilotOpen && <CopilotDock configured={copilotConfigured} seed={seed} onClose={() => setCopilotOpen(false)} />}
        </div>
      </div>
    </div>
    </CopilotContext.Provider>
  );
}
