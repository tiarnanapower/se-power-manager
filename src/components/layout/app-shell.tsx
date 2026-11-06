import { DataModeBanner } from "@/components/layout/data-mode-banner";
import { ShellFrame } from "@/components/shell/shell-frame";
import { getDataMode } from "@/lib/bc-api-client/data-mode";
import { isCopilotConfigured } from "@/lib/copilot/portkey";

const MODE_LABEL: Record<string, string> = { MOCK: "Demo data", STATIC: "Static token", MULTITENANT: "Installed app" };

// The shell chrome has no dynamic dependency of its own, so this is a plain,
// sync Server Component that renders immediately regardless of how long
// `children` takes to resolve. The interactive frame is a client component.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellFrame banner={<DataModeBanner />} modeLabel={MODE_LABEL[getDataMode()] ?? "Store"} copilotConfigured={isCopilotConfigured()}>
      {children}
    </ShellFrame>
  );
}
