import { SettingsView } from "@/components/settings/settings-view";
import { getDataMode } from "@/lib/bc-api-client/data-mode";

type PageProps = { params: Promise<Record<string, string | string[] | undefined>> };

const MODE_LABEL = { MOCK: "Demo data", STATIC: "Static token (local)", MULTITENANT: "Installed app" } as const;

// Only booleans and non-secret labels cross to the client; the Portkey key and
// store token are never serialized.
export async function SettingsPage({ params }: PageProps) {
  const resolved = await params;
  const raw = resolved.storeHash;
  const storeHash = Array.isArray(raw) ? raw[0] : raw;
  const mode = getDataMode();
  const staticHash = process.env.STATIC_STORE_HASH;
  const shown = storeHash ?? (mode === "STATIC" ? staticHash : undefined);

  return (
    <SettingsView
      storeHash={storeHash}
      connection={{
        modeLabel: MODE_LABEL[mode],
        store: shown ? `${shown.slice(0, 3)}${"•".repeat(Math.max(shown.length - 3, 0))}` : "None (demo data)",
        canTest: mode !== "MOCK",
      }}
      copilot={{
        configured: Boolean(process.env.PORTKEY_API_KEY),
        model: process.env.PORTKEY_MODEL ?? "Not set",
      }}
    />
  );
}
