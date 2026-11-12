// Reads a ZIP archive in the browser (or Node) so a snapshot can be uploaded. Handles stored and
// deflated entries, which covers zips made by this app, `zip`, Finder and Explorer.
const MAX_ENTRIES = 50_000;
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());

  if (out.length !== expected) throw new Error("A file in the zip is damaged.");

  return out;
}

// Path -> contents. Folders, macOS resource files and Thumbs.db are left out.
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = view(bytes);
  let end = -1;

  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at -= 1) {
    if (dv.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }

  if (end < 0) throw new Error("That doesn't look like a zip file.");

  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);

  if (count > MAX_ENTRIES) throw new Error("That zip has too many files.");

  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  let total = 0;

  for (let entry = 0; entry < count; entry += 1) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error("That zip is damaged.");

    const method = dv.getUint16(at + 10, true);
    const compressed = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const offset = dv.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, "/");

    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.includes("/__MACOSX/") || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name)) continue;
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error("Zip files over 4 GB aren't supported.");
    if (size > MAX_ENTRY_BYTES) throw new Error(`${name} is too large to load.`);

    total += size;

    if (total > MAX_TOTAL_BYTES) throw new Error("That zip is too large to load in the browser.");
    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error("That zip is damaged.");

    const start = offset + 30 + dv.getUint16(offset + 26, true) + dv.getUint16(offset + 28, true);
    const data = bytes.subarray(start, start + compressed);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data, size));
    else throw new Error(`${name} uses a zip compression this app can't read.`);
  }

  return files;
}
