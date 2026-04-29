/**
 * Tests for block-memory + guidance-whisper.
 *
 * Notes on isolation:
 *   - Each test sets WOTANN_HOME to a unique temp dir so blocks don't
 *     leak across tests.
 *   - We restore the previous WOTANN_HOME in afterEach. Tests in this
 *     file therefore can't run with --shard= without further work, but
 *     vitest's default fork-pool isolation handles this fine.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BLOCK_KINDS,
  appendBlock,
  clearBlock,
  getBlockLimit,
  listBlocks,
  readBlock,
  renderActiveBlocks,
  writeBlock,
} from "../../src/memory/block-memory.js";
import { WhisperChannel, renderWhisper } from "../../src/memory/guidance-whisper.js";

let prevHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "wotann-blocks-"));
  prevHome = process.env.WOTANN_HOME;
  process.env.WOTANN_HOME = tempDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.WOTANN_HOME;
  else process.env.WOTANN_HOME = prevHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("block-memory", () => {
  it("round-trips a block", () => {
    writeBlock("persona", "I am terse and direct.");
    const got = readBlock("persona");
    expect(got?.content).toBe("I am terse and direct.");
    expect(got?.truncatedAt).toBeUndefined();
  });

  it("truncates content exceeding the limit", () => {
    const oversized = "x".repeat(getBlockLimit("scratch") + 100);
    const block = writeBlock("scratch", oversized);
    expect(block.content.length).toBe(getBlockLimit("scratch"));
    expect(block.truncatedAt).toBeDefined();
  });

  it("appendBlock concatenates with separator", () => {
    writeBlock("issues", "first");
    appendBlock("issues", "second");
    expect(readBlock("issues")?.content).toBe("first\nsecond");
  });

  it("clearBlock removes the file and returns false on second clear", () => {
    writeBlock("scratch", "ephemeral");
    expect(clearBlock("scratch")).toBe(true);
    expect(clearBlock("scratch")).toBe(false);
    expect(readBlock("scratch")).toBeNull();
  });

  it("listBlocks reports byte counts and truncation", () => {
    writeBlock("persona", "small");
    const oversized = "y".repeat(getBlockLimit("scratch") + 50);
    writeBlock("scratch", oversized);
    const summaries = listBlocks();
    const persona = summaries.find((s) => s.kind === "persona");
    const scratch = summaries.find((s) => s.kind === "scratch");
    expect(persona?.bytes).toBe(5);
    expect(persona?.truncated).toBe(false);
    expect(scratch?.bytes).toBe(getBlockLimit("scratch"));
    expect(scratch?.truncated).toBe(true);
  });

  it("renderActiveBlocks includes only non-empty blocks in canonical XML form", () => {
    writeBlock("persona", "I'm WOTANN.");
    writeBlock("human", "User is Gabriel.");
    writeBlock("task", "");
    const rendered = renderActiveBlocks();
    expect(rendered).toContain("<core_memory>");
    expect(rendered).toContain('<block kind="persona"');
    expect(rendered).toContain("I'm WOTANN.");
    expect(rendered).toContain('<block kind="human"');
    expect(rendered).not.toContain('kind="task"');
  });

  it("BLOCK_KINDS contains the documented 12 slots", () => {
    expect(BLOCK_KINDS.length).toBe(12);
    expect(new Set(BLOCK_KINDS).size).toBe(12);
  });
});

describe("WhisperChannel + renderWhisper", () => {
  it("drain orders by priority then enqueue time, and consumes one-shots", () => {
    const ch = WhisperChannel.create();
    ch.enqueue("low-1", "low");
    ch.enqueue("high-1", "high");
    ch.enqueue("normal-1", "normal");
    ch.enqueue("high-2", "high");
    const drained = ch.drain(true);
    expect(drained.map((w) => w.text)).toEqual(["high-1", "high-2", "normal-1", "low-1"]);
    expect(ch.size()).toBe(0);
  });

  it("retains non-oneShot whispers across drains", () => {
    const ch = WhisperChannel.create();
    ch.enqueue("sticky", "normal", false);
    ch.enqueue("transient", "normal", true);
    ch.drain(true);
    expect(ch.size()).toBe(1);
    expect(ch.drain(false).map((w) => w.text)).toEqual(["sticky"]);
  });

  it("renderWhisper combines core memory and queued whispers", () => {
    writeBlock("persona", "Mission: code with care.");
    const ch = WhisperChannel.create();
    ch.enqueue("Watch out for off-by-one.", "high");
    const out = renderWhisper(ch);
    expect(out).toContain("<guidance");
    expect(out).toContain("<core_memory>");
    expect(out).toContain("<whispers>");
    expect(out).toContain("Watch out for off-by-one.");
    expect(out).toContain('priority="high"');
  });

  it("returns empty string when nothing is active", () => {
    const ch = WhisperChannel.create();
    expect(renderWhisper(ch)).toBe("");
    expect(renderWhisper(null)).toBe("");
  });

  it("escapes XML special chars in whisper text", () => {
    const ch = WhisperChannel.create();
    ch.enqueue('a < b && c > d "ok"', "normal");
    writeBlock("persona", "anchor"); // ensure a non-empty render
    const out = renderWhisper(ch);
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;");
  });
});
