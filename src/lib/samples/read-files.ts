"use client";

// Reads what the user picked or dropped (a zip, or a folder) into one map of path -> bytes, the form
// openBundle works on. Browser only.
import { readZip } from "@/lib/samples/zip-read";

const MAX_FILES = 50_000;

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

async function walk(entry: FileSystemEntry, into: Map<string, Uint8Array>, prefix = ""): Promise<void> {
  if (into.size > MAX_FILES) throw new Error("That folder has too many files.");

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));

    if (!/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(`${prefix}${entry.name}`)) into.set(`${prefix}${entry.name}`, await bytesOf(file));

    return;
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

    if (batch.length === 0) break;

    for (const child of batch) await walk(child, into, `${prefix}${entry.name}/`);
  }
}

// Files from <input type="file"> (a zip, or a folder with webkitdirectory).
export async function readPicked(list: FileList): Promise<Map<string, Uint8Array>> {
  const files = [...list];

  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return readZip(await bytesOf(files[0]));

  if (files.length > MAX_FILES) throw new Error("That folder has too many files.");

  const out = new Map<string, Uint8Array>();

  for (const file of files) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(path)) continue;

    out.set(path, await bytesOf(file));
  }

  return out;
}

// Items dropped onto the page: a zip, or one or more folders.
export async function readDropped(transfer: DataTransfer): Promise<Map<string, Uint8Array>> {
  const entries = [...transfer.items].map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
  const single = entries.length === 1 ? entries[0] : undefined;

  if (single?.isFile && /\.zip$/i.test(single.name)) {
    const file = await new Promise<File>((resolve, reject) => (single as FileSystemFileEntry).file(resolve, reject));

    return readZip(await bytesOf(file));
  }

  const out = new Map<string, Uint8Array>();

  for (const entry of entries) await walk(entry, out);

  return out;
}
