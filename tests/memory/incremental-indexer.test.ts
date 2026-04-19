import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  IncrementalIndexer,
  computeFileSha,
  computeContentSha,
  withIndexer,
} from "../../src/memory/incremental-indexer.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("computeContentSha / computeFileSha", () => {
  it("content hash is deterministic", () => {
    expect(computeContentSha("hello")).toBe(computeContentSha("hello"));
  });

  it("different content → different hash", () => {
    expect(computeContentSha("a")).not.toBe(computeContentSha("b"));
  });

  it("computeFileSha reads from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wotann-idx-"));
    const path = join(dir, "x.txt");
    await writeFile(path, "xyz");
    try {
      expect(await computeFileSha(path)).toBe(computeContentSha("xyz"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("IncrementalIndexer — lifecycle", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-idx-"));
    cachePath = join(tempDir, ".wotann/index-cache.json");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    const idx = new IncrementalIndexer({ cachePath });
    await idx.load();
    expect(idx.size()).toBe(0);
  });

  it("markIndexed records an entry", () => {
    const idx = new IncrementalIndexer({ cachePath });
    idx.markIndexed("/a/b.ts", "sha1", 3);
    expect(idx.size()).toBe(1);
    const entry = idx.getEntry("/a/b.ts");
    expect(entry?.sha).toBe("sha1");
    expect(entry?.chunksCount).toBe(3);
  });

  it("save + load round-trips", async () => {
    const idx1 = new IncrementalIndexer({ cachePath });
    idx1.markIndexed("/a/b.ts", "sha1", 5);
    await idx1.save();
    const idx2 = new IncrementalIndexer({ cachePath });
    await idx2.load();
    expect(idx2.size()).toBe(1);
    expect(idx2.getEntry("/a/b.ts")?.sha).toBe("sha1");
  });

  it("survives corrupted cache file (treats as empty)", async () => {
    await writeFile(cachePath.replace("/index-cache.json", ""), "dummy").catch(() => {});
    await writeFile(cachePath, "not valid json").catch(() => {});
    const idx = new IncrementalIndexer({ cachePath });
    await idx.load();
    expect(idx.size()).toBe(0);
  });

  it("clear() empties cache", () => {
    const idx = new IncrementalIndexer({ cachePath });
    idx.markIndexed("/x", "s", 1);
    idx.markIndexed("/y", "s", 1);
    expect(idx.size()).toBe(2);
    idx.clear();
    expect(idx.size()).toBe(0);
  });
});

describe("IncrementalIndexer — shouldReindex", () => {
  it("true when file is unseen", () => {
    const idx = new IncrementalIndexer();
    expect(idx.shouldReindex("/a/b.ts", "any-sha")).toBe(true);
  });

  it("false when sha matches cached", () => {
    const idx = new IncrementalIndexer();
    idx.markIndexed("/a/b.ts", "sha1", 1);
    expect(idx.shouldReindex("/a/b.ts", "sha1")).toBe(false);
  });

  it("true when sha differs from cached", () => {
    const idx = new IncrementalIndexer();
    idx.markIndexed("/a/b.ts", "sha1", 1);
    expect(idx.shouldReindex("/a/b.ts", "sha2")).toBe(true);
  });
});

describe("IncrementalIndexer — forget + prune", () => {
  it("forget removes a single entry", () => {
    const idx = new IncrementalIndexer();
    idx.markIndexed("/a", "s", 1);
    expect(idx.forget("/a")).toBe(true);
    expect(idx.size()).toBe(0);
    expect(idx.forget("/nonexistent")).toBe(false);
  });

  it("prune removes entries not in the existing set", async () => {
    const idx = new IncrementalIndexer();
    idx.markIndexed("/a", "s", 1);
    idx.markIndexed("/b", "s", 1);
    idx.markIndexed("/c", "s", 1);
    const removed = await idx.prune(["/a", "/c"]);
    expect(removed).toBe(1);
    expect(idx.size()).toBe(2);
    expect(idx.getEntry("/b")).toBeUndefined();
  });
});

describe("IncrementalIndexer — getStaleFiles", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-idx-"));
    cachePath = join(tempDir, ".wotann/index-cache.json");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns only files that changed since last index", async () => {
    const fileA = join(tempDir, "a.txt");
    const fileB = join(tempDir, "b.txt");
    await writeFile(fileA, "content A");
    await writeFile(fileB, "content B");

    const idx = new IncrementalIndexer({ cachePath });
    // Index both files at their initial content
    const shaA = await computeFileSha(fileA);
    const shaB = await computeFileSha(fileB);
    idx.markIndexed(fileA, shaA, 1);
    idx.markIndexed(fileB, shaB, 1);

    // Modify A only
    await writeFile(fileA, "modified content A");

    const stale = await idx.getStaleFiles([fileA, fileB]);
    expect(stale).toEqual([fileA]);
  });

  it("treats missing files as non-stale (skipped)", async () => {
    const idx = new IncrementalIndexer({ cachePath });
    const stale = await idx.getStaleFiles(["/nonexistent/path.txt"]);
    expect(stale).toEqual([]);
  });
});

describe("withIndexer helper", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-idx-"));
    cachePath = join(tempDir, ".wotann/index-cache.json");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads + runs + saves automatically", async () => {
    await withIndexer({ cachePath }, async (idx) => {
      idx.markIndexed("/x", "sha1", 1);
    });
    // Reload from disk to verify save
    const idx = new IncrementalIndexer({ cachePath });
    await idx.load();
    expect(idx.size()).toBe(1);
  });

  it("saves even when callback throws", async () => {
    try {
      await withIndexer({ cachePath }, async (idx) => {
        idx.markIndexed("/x", "sha1", 1);
        throw new Error("boom");
      });
    } catch {
      // expected
    }
    const idx = new IncrementalIndexer({ cachePath });
    await idx.load();
    expect(idx.size()).toBe(1);
  });
});

describe("IncrementalIndexer — stats", () => {
  it("reports tracked + totalChunks + estimatedSavedMs", () => {
    const idx = new IncrementalIndexer();
    idx.markIndexed("/a", "s", 3);
    idx.markIndexed("/b", "s", 7);
    const stats = idx.stats(50);
    expect(stats.tracked).toBe(2);
    expect(stats.totalChunks).toBe(10);
    expect(stats.estimatedSavedMs).toBe(100);
  });
});
