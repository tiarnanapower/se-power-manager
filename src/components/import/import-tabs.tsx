"use client";

import { useState } from "react";
import { ImportView } from "@/components/import/import-view";
import { SiteBrief } from "@/components/import/site-brief";

// Both tabs stay mounted and are only hidden, so switching never loses scraped products or a brief.
export function ImportTabs({ storeHash, aiConfigured, canWrite }: { storeHash: string | undefined; aiConfigured: boolean; canWrite: boolean }) {
  const [tab, setTab] = useState<"products" | "brief">("products");

  return (
    <>
      <div className="pp-tabs" role="tablist" aria-label="What to import">
        <button type="button" role="tab" aria-selected={tab === "products"} className="pp-tabs__tab" onClick={() => setTab("products")}>Products</button>
        <button type="button" role="tab" aria-selected={tab === "brief"} className="pp-tabs__tab" onClick={() => setTab("brief")}>Site brief for Makeswift</button>
      </div>
      <div hidden={tab !== "products"}><ImportView storeHash={storeHash} aiConfigured={aiConfigured} canWrite={canWrite} /></div>
      <div hidden={tab !== "brief"}><SiteBrief storeHash={storeHash} aiConfigured={aiConfigured} canWrite={canWrite} /></div>
    </>
  );
}
