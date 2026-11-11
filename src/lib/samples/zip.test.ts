import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, createZip } from "@/lib/samples/zip";

describe("createZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("makes an archive the system unzip can read back byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const image = Uint8Array.from([0, 255, 1, 254, 2, 253]);
    const zip = createZip(new Map<string, string | Uint8Array>([["samples/a/v1/catalog.json", '{"é":1}'], ["images/x.jpg", image]]));

    writeFileSync(join(dir, "out.zip"), zip);
    execFileSync("unzip", ["-q", join(dir, "out.zip"), "-d", join(dir, "out")]);

    expect(readFileSync(join(dir, "out/samples/a/v1/catalog.json"), "utf8")).toBe('{"é":1}');
    expect([...readFileSync(join(dir, "out/images/x.jpg"))]).toEqual([...image]);
  });
});
