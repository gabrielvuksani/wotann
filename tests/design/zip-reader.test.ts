/**
 * ZIP reader tests — exercises STORED + DEFLATE paths and malformed bundles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZip } from "../../src/design/zip-reader.js";
import { buildZipBuffer } from "./zip-fixture.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wotann-zip-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(name: string, buf: Buffer): string {
  const path = join(tmp, name);
  writeFileSync(path, buf);
  return path;
}

describe("readZip", () => {
  it("reads DEFLATE-compressed entries", () => {
    const zip = buildZipBuffer([
      { name: "manifest.json", contents: JSON.stringify({ ok: true }), deflate: true },
    ]);
    const archive = readZip(writeFixture("a.zip", zip));
    const entry = archive.entry("manifest.json");
    expect(entry).toBeDefined();
    expect(entry?.data().toString("utf-8")).toBe(`{"ok":true}`);
  });

  it("reads STORED (uncompressed) entries", () => {
    const zip = buildZipBuffer([
      { name: "small.txt", contents: "hi", deflate: false },
    ]);
    const archive = readZip(writeFixture("b.zip", zip));
    expect(archive.entry("small.txt")?.data().toString("utf-8")).toBe("hi");
  });

  it("lists all entries in order", () => {
    const zip = buildZipBuffer([
      { name: "first.txt", contents: "1" },
      { name: "second.txt", contents: "2" },
      { name: "third.txt", contents: "3" },
    ]);
    const archive = readZip(writeFixture("c.zip", zip));
    expect(archive.entries.map((e) => e.name)).toEqual([
      "first.txt",
      "second.txt",
      "third.txt",
    ]);
  });

  it("rejects a non-ZIP payload with a descriptive error", () => {
    const path = writeFixture("junk.zip", Buffer.from("not a zip archive"));
    expect(() => readZip(path)).toThrow(/not a valid ZIP archive/);
  });

  it("rejects a missing file with a readable error", () => {
    expect(() => readZip(join(tmp, "missing.zip"))).toThrow(/cannot read ZIP file/);
  });
});
