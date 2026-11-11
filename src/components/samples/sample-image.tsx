"use client";

import { useState } from "react";

// A sample picture, served by /api/sample-image. Falls back to a plain tile if it can't load.
export function sampleImageUrl(file: string, storeHash: string | undefined): string {
  return `/api/sample-image/${file}${storeHash ? `?s=${encodeURIComponent(storeHash)}` : ""}`;
}

export function SampleImage({ file, storeHash, className = "pp-pack__tile" }: { file: string | null; storeHash: string | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={className}>
      {file && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- proxied from the samples repo, already sized by the capture.
        <img src={sampleImageUrl(file, storeHash)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="pp-muted" style={{ fontSize: 12 }}>No image</span>
      )}
    </div>
  );
}
