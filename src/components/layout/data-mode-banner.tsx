import { getDataMode } from "@/lib/bc-api-client/data-mode";

const MESSAGE: Record<"MOCK" | "STATIC", string> = {
  MOCK: "Demo data mode: nothing here is connected to a store.",
  STATIC: "Static token mode: all routes are unprotected, so don't deploy this configuration to production.",
};

// A slim one-line notice in the two development-only data modes.
export function DataModeBanner() {
  const dataMode = getDataMode();

  if (dataMode !== "MOCK" && dataMode !== "STATIC") return null;

  return (
    <div className="pp-mode-banner" role="note">
      {MESSAGE[dataMode]}
    </div>
  );
}
