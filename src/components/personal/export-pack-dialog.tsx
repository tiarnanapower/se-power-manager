"use client";

import { useState } from "react";
import { getPackExportPageAction, getPackImageAction } from "@/app/store/[storeHash]/catalog/personal/actions";
import { getRepoStateAction } from "@/app/store/[storeHash]/catalog/personal/snapshot-actions";
import { Modal } from "@/components/samples/modal";
import type { PackProduct, PackSummary } from "@/lib/app-data/types";
import { CATEGORY_SEPARATOR, type PackProductRaw } from "@/lib/catalog/pack-mapper";
import { assembleSample } from "@/lib/samples/assemble";
import { isSlug, slugify } from "@/lib/samples/format";
import { createZip } from "@/lib/samples/zip";

type Phase = "form" | "running" | "done";

const fromBase64 = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Every category a product sits in, plus its parents ("A > B > C" also needs "A > B" and "A").
function withAncestors(paths: string[]): string[] {
  const all = new Set<string>();

  for (const path of paths) {
    const parts = path.split(CATEGORY_SEPARATOR);

    for (let length = 1; length <= parts.length; length += 1) all.add(parts.slice(0, length).join(CATEGORY_SEPARATOR));
  }

  return [...all];
}

// Packs a saved catalog into the files of a new sample (or a new version of one) for the samples repo,
// as a zip laid out like the repo itself: unzip it over a clone, commit and push.
export function ExportPackDialog({ storeHash, pack, onClose }: { storeHash: string | undefined; pack: PackSummary; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState(pack.name);
  const [slug, setSlug] = useState(slugify(pack.name));
  const [description, setDescription] = useState(pack.description);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ file: string; version: string; products: number; images: number; warnings: string[] }>();

  const valid = name.trim().length > 0 && isSlug(slug);

  const run = async () => {
    setPhase("running");
    setError(undefined);
    setProgress(0);

    try {
      setStage("Checking the sample repo");

      const context = await getRepoStateAction(storeHash, { slug });

      if (!context.ok) throw new Error(context.message);

      const products: PackProduct[] = [];
      const pictures = new Map<string, { bytes: Uint8Array; mime: string }>();
      let total = pack.productCount;

      for (let offset = 0; offset < total; ) {
        setStage(`Reading products ${offset + 1}–${Math.min(offset + 25, total)} of ${total}`);

        const page = await getPackExportPageAction(storeHash, { packId: pack.id, offset });

        if (!page.ok) throw new Error(page.message);
        if (page.products.length === 0) break;

        total = page.total;

        const urls = [...new Set(page.products.flatMap((product) => ((product.raw as unknown as Partial<PackProductRaw>).images ?? []).map((image) => image.url)).filter(Boolean))];

        for (let at = 0; at < urls.length; at += 3) {
          await Promise.all(urls.slice(at, at + 3).map(async (url) => {
            const picture = await getPackImageAction(storeHash, { packId: pack.id, offset, url });

            if (picture.ok && picture.image) pictures.set(url, { bytes: fromBase64(picture.image.base64), mime: picture.image.mime });
          }));
        }

        products.push(...page.products);
        offset += page.products.length;
        setProgress(Math.min(0.9, offset / total));
      }

      setStage("Building the files");

      const existing: Record<string, string | null> = { "catalog.json": context.index, [`samples/${slug}/sample.json`]: context.meta };
      const assembled = await assembleSample(
        {
          products,
          categoryPaths: withAncestors(products.flatMap((product) => product.categoryPaths)),
          brands: products.map((product) => (product.raw as { brandName?: string | null }).brandName).filter((brand): brand is string => Boolean(brand)),
        },
        {
          name: name.trim(),
          slug,
          description: description.trim(),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          notes: notes.trim(),
          readExisting: async (path) => existing[path] ?? undefined,
          fetchImage: async (url) => pictures.get(url),
          sha256,
        },
      );

      setStage("Zipping");

      const zip = createZip(assembled.files);
      const file = `${slug}-${assembled.version}.zip`;
      const link = document.createElement("a");

      link.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      link.download = file;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

      setProgress(1);
      setResult({ file, version: assembled.version, products: assembled.counts.products, images: assembled.counts.images, warnings: assembled.warnings.slice(0, 30) });
      setPhase("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The export failed.");
      setPhase("form");
    }
  };

  return (
    <Modal
      title="Download as a snapshot"
      onClose={phase === "running" ? () => undefined : onClose}
      footer={
        phase === "form" ? (
          <>
            <button type="button" className="pp-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={run} disabled={!valid}>Export zip</button>
          </>
        ) : phase === "running" ? null : (
          <button type="button" className="pp-btn pp-btn--primary" onClick={onClose}>Close</button>
        )
      }
    >
      {phase === "form" && (
        <div>
          <p className="pp-section__hint">Turns <strong>{pack.name}</strong> into a snapshot zip in the Demo Snapshots format. You can upload it again under My Snapshots, or add it to the demo snapshots repo.</p>
          <label className="pp-field"><span>Sample name</span><input className="pp-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
          <label className="pp-field"><span>Name in the repo</span><input className="pp-input" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} maxLength={64} aria-invalid={!isSlug(slug)} /><small className="pp-muted">Lower-case letters, numbers and dashes. Reuse an existing one to add a version.</small></label>
          <label className="pp-field"><span>Description</span><input className="pp-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
          <label className="pp-field"><span>Tags</span><input className="pp-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="uk, outdoor" /></label>
          <label className="pp-field"><span>What changed in this version</span><input className="pp-input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Shown in the version history" maxLength={300} /></label>
          {pack.imagesState === "skipped" && <div className="pp-warn">This pack only links to its pictures, so any that BigCommerce has since deleted will be left out.</div>}
          {error && <div role="status" className="pp-msg pp-msg--err">{error}</div>}
        </div>
      )}

      {phase === "running" && (
        <div>
          <strong>{stage}</strong>
          <div className="pp-progress is-active"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      )}

      {phase === "done" && result && (
        <div>
          <div role="status" className="pp-msg pp-msg--ok">Downloaded {result.file}: {result.products} products and {result.images} pictures as {result.version}.</div>
          <ol className="pp-steps">
            <li>Unzip it into your clone of the sample repo and let it merge with what is there.</li>
            <li>Check it with <code>git status</code>, then commit and push it.</li>
            <li>Demo Snapshots shows it once GitHub has it (within a few minutes).</li>
          </ol>
          {result.warnings.length > 0 && (
            <>
              <p className="pp-section__hint">Worth a look before you push:</p>
              <ul className="pp-errlist">{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
