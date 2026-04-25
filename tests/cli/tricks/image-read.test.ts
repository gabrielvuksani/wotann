/**
 * Tests for src/cli/tricks/image-read.ts (T12.2).
 *
 * Strategy:
 *   - Write small known byte sequences to a temp dir + extension and
 *     assert base64 + mime extraction.
 *   - Honest-stub assertions for missing files, unsupported extensions,
 *     bad path types.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readImage,
  SUPPORTED_EXTENSIONS,
} from "../../../src/cli/tricks/image-read.js";

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "wotann-img-read-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("readImage — supported formats", () => {
  it("decodes a PNG file to base64 + image/png", async () => {
    // 1x1 transparent PNG, the smallest valid PNG (67 bytes).
    const png = Buffer.from(
      "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
        "1F15C4890000000A49444154789C63000100000500010D0A2DB400000000" +
        "49454E44AE426082",
      "hex",
    );
    const path = join(workDir, "tiny.png");
    await writeFile(path, png);
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/png");
    expect(r.byteLength).toBe(png.byteLength);
    // base64 round-trip preserves bytes exactly.
    expect(Buffer.from(r.base64, "base64").equals(png)).toBe(true);
  });

  it("maps .jpg to image/jpeg", async () => {
    const path = join(workDir, "x.jpg");
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/jpeg");
  });

  it("maps .jpeg to image/jpeg", async () => {
    const path = join(workDir, "x.jpeg");
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/jpeg");
  });

  it("maps .gif to image/gif", async () => {
    const path = join(workDir, "x.gif");
    await writeFile(path, Buffer.from("GIF89a"));
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/gif");
  });

  it("maps .webp to image/webp", async () => {
    const path = join(workDir, "x.webp");
    await writeFile(path, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/webp");
  });

  it("treats extensions case-insensitively", async () => {
    const path = join(workDir, "X.PNG");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await readImage(path);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/png");
  });
});

describe("readImage — honest-stub failures (QB #6)", () => {
  it("rejects missing file with helpful error", async () => {
    const r = await readImage(join(workDir, "no-such-file.png"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/failed to read/);
    expect(r.error).toContain("no-such-file.png");
  });

  it("rejects unsupported extension with name + supported list", async () => {
    const path = join(workDir, "x.bmp");
    await writeFile(path, Buffer.from([0x42, 0x4d]));
    const r = await readImage(path);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unsupported extension/);
    expect(r.error).toMatch(/\.bmp/);
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(r.error).toContain(ext);
    }
  });

  it("rejects empty path", async () => {
    const r = await readImage("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty/);
  });

  it("rejects non-string path", async () => {
    // @ts-expect-error — runtime validation
    const r = await readImage(123);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty/);
  });
});

describe("SUPPORTED_EXTENSIONS catalog", () => {
  it("is frozen and contains the documented formats", () => {
    expect(Object.isFrozen(SUPPORTED_EXTENSIONS)).toBe(true);
    expect(SUPPORTED_EXTENSIONS).toContain(".png");
    expect(SUPPORTED_EXTENSIONS).toContain(".jpg");
    expect(SUPPORTED_EXTENSIONS).toContain(".jpeg");
    expect(SUPPORTED_EXTENSIONS).toContain(".gif");
    expect(SUPPORTED_EXTENSIONS).toContain(".webp");
  });
});
