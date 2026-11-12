import { SettingsView } from "@/components/settings/settings-view";
import { getBigGearStatus } from "@/lib/big-gear/config";
import { getDataMode } from "@/lib/bc-api-client/data-mode";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

const MODE_LABEL = { MOCK: "Demo data", STATIC: "Static token (local)", MULTITENANT: "Installed app" } as const;

// Only booleans and non-secret labels cross to the client; tokens and the
// Portkey key are never serialized.
export async function SettingsPage({ params }: PageProps) {
  const resolved = await params;
  const raw = resolved.storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  const mode = getDataMode();
  const shown = storeHash ?? (mode === "STATIC" ? process.env.STATIC_STORE_HASH : undefined);
  const gear = getBigGearStatus();

  return (
    <SettingsView
      storeHash={storeHash}
      connection={{
        modeLabel: MODE_LABEL[mode],
        store: shown ? `${shown.slice(0, 3)}${"•".repeat(Math.max(shown.length - 3, 0))}` : "None (demo data)",
        canTest: mode !== "MOCK",
      }}
      bigGear={{ configured: gear.storeConfigured, storeLabel: gear.storeLabel, repoLabel: gear.repoLabel, githubToken: gear.githubTokenConfigured, canTest: mode !== "MOCK" && gear.storeConfigured }}
      ai={{ configured: Boolean(process.env.PORTKEY_API_KEY), model: process.env.PORTKEY_MODEL ?? "Not set" }}
    />
  );
}
