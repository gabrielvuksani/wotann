/**
 * Tests for stable-prefix — provider prompt cache compatibility.
 *
 * Covers:
 *   1. Empty store → empty prefix with stable hash.
 *   2. Non-empty store → prefix header + bullet list of entries.
 *   3. BYTE-IDENTICAL across repeated calls (cache-key stability).
 *   4. Insertion order does NOT affect output (deterministic sort).
 *   5. Emoji priority markers when opted in.
 *   6. toAnthropicCachedBlocks emits cache_control on non-empty prefix.
 *   7. toAnthropicCachedBlocks returns [] for empty prefix.
 *   8. Working-layer entries are excluded (only core_blocks).
 *   9. `maxEntriesPerBlock` caps per-block rendering.
 *  10. Honest fallback when store.getByLayer throws.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildStablePrefix,
  toAnthropicCachedBlocks,
  openaiMinimumStablePrefixChars,
} from "../../src/memory/stable-prefix.js";
import { MemoryStore, type MemoryBlockType, type MemoryEntry } from "../../src/memory/store.js";

// ── Setup ──────────────────────────────────────────────

let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "stable-prefix-test-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function insertCore(
  id: string,
  block: MemoryBlockType,
  value: string,
  confidence: number = 0.8,
): void {
  store.insert({
    id,
    layer: "core_blocks",
    blockType: block,
    key: `key-${id}`,
    value,
    verified: true,
    freshnessScore: 1.0,
    // MemoryStore.insert() persists `confidence` (column: confidence)
    // — `confidenceLevel` is a separate column the verify pipeline
    // sets. Tests target `confidence` so sort + emoji tiers reflect
    // the inserted value.
    confidence,
    confidenceLevel: confidence,
    verificationStatus: "unverified",
  });
}

// ── Tests ──────────────────────────────────────────────

describe("buildStablePrefix", () => {
  it("empty store → empty prefix, stable hash (sha256(''))", () => {
    const result = buildStablePrefix(store);
    expect(result.stablePrefix).toBe("");
    expect(result.entryCount).toBe(0);
    // sha256 of empty string.
    expect(result.stablePrefixHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("null store → empty prefix, does not throw", () => {
    const result = buildStablePrefix(null);
    expect(result.stablePrefix).toBe("");
    expect(result.entryCount).toBe(0);
  });

  it("renders core_blocks entries with header + bullets", () => {
    insertCore("1", "user", "Gabriel Vuksani — Full Stack Dev, Toronto", 0.9);
    insertCore("2", "decisions", "Use OAuth 2.0 over OAuth 1.0", 0.85);
    insertCore("3", "feedback", "Prefer TDD with RED-GREEN-REFACTOR", 0.8);

    const result = buildStablePrefix(store);
    expect(result.stablePrefix).toContain("## Stable Memory");
    expect(result.stablePrefix).toContain("User facts");
    expect(result.stablePrefix).toContain("Decisions");
    expect(result.stablePrefix).toContain("Preferences & feedback");
    expect(result.stablePrefix).toContain("Gabriel Vuksani");
    expect(result.stablePrefix).toContain("OAuth 2.0");
    expect(result.stablePrefix).toContain("TDD");
    expect(result.entryCount).toBe(3);
  });

  it("is BYTE-IDENTICAL across repeated calls (cache-key stability)", () => {
    insertCore("1", "user", "Fact A", 0.9);
    insertCore("2", "decisions", "Decision B", 0.85);
    insertCore("3", "feedback", "Preference C", 0.8);

    const first = buildStablePrefix(store);
    const second = buildStablePrefix(store);
    const third = buildStablePrefix(store);

    // Full string identity.
    expect(second.stablePrefix).toBe(first.stablePrefix);
    expect(third.stablePrefix).toBe(first.stablePrefix);
    // Hash identity — the whole point of this module.
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash);
    expect(third.stablePrefixHash).toBe(first.stablePrefixHash);
  });

  it("insertion order does NOT affect output (deterministic sort)", () => {
    // Session A: insert in order A, B, C.
    insertCore("a1", "user", "Fact A", 0.9);
    insertCore("a2", "user", "Fact B", 0.9);
    insertCore("a3", "user", "Fact C", 0.9);
    const first = buildStablePrefix(store);

    // Session B: different store, insert in reverse order.
    const tempB = mkdtempSync(join(tmpdir(), "sp-test-b-"));
    const storeB = new MemoryStore(join(tempB, "memory.db"));
    try {
      const insertB = (id: string, value: string) => {
        storeB.insert({
          id,
          layer: "core_blocks",
          blockType: "user",
          key: `key-${id}`,
          value,
          verified: true,
          freshnessScore: 1.0,
          confidence: 0.9,
          confidenceLevel: 0.9,
          verificationStatus: "unverified",
        });
      };
      insertB("a3", "Fact C");
      insertB("a1", "Fact A");
      insertB("a2", "Fact B");
      const second = buildStablePrefix(storeB);
      expect(second.stablePrefix).toBe(first.stablePrefix);
      expect(second.stablePrefixHash).toBe(first.stablePrefixHash);
    } finally {
      storeB.close();
      rmSync(tempB, { recursive: true, force: true });
    }
  });

  it("emoji priority markers applied when opted in", () => {
    insertCore("1", "user", "Critical fact", 0.9);
    insertCore("2", "user", "Medium fact", 0.6);
    insertCore("3", "user", "Informational fact", 0.3);

    const result = buildStablePrefix(store, { useEmojiPriority: true });
    expect(result.stablePrefix).toContain("🔴");
    expect(result.stablePrefix).toContain("🟡");
    expect(result.stablePrefix).toContain("🟢");
  });

  it("emoji markers absent when not opted in (default)", () => {
    insertCore("1", "user", "Fact", 0.9);
    const result = buildStablePrefix(store);
    expect(result.stablePrefix).not.toContain("🔴");
    expect(result.stablePrefix).not.toContain("🟡");
    expect(result.stablePrefix).not.toContain("🟢");
  });

  it("excludes working-layer entries — only core_blocks contributes", () => {
    // working layer entry — should be excluded.
    store.insert({
      id: "w1",
      layer: "working",
      blockType: "decisions",
      key: "w-1",
      value: "Working-layer decision — must NOT leak into stable prefix",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.9,
      verificationStatus: "unverified",
    });
    // core_blocks entry — should be included.
    insertCore("c1", "decisions", "Core decision — stable", 0.9);

    const result = buildStablePrefix(store);
    expect(result.stablePrefix).not.toContain("Working-layer decision");
    expect(result.stablePrefix).toContain("Core decision");
    expect(result.entryCount).toBe(1);
  });

  it("maxEntriesPerBlock caps per-block rendering", () => {
    for (let i = 0; i < 20; i++) {
      insertCore(`u${i}`, "user", `Fact #${i}`, 0.9);
    }
    const result = buildStablePrefix(store, { maxEntriesPerBlock: 3 });
    // Should include exactly 3 entries for "user" block.
    expect(result.entryCount).toBe(3);
  });

  it("honest fallback when store.getByLayer throws — no crash", () => {
    const brokenStore = {
      getByLayer: () => {
        throw new Error("simulated store failure");
      },
    } as unknown as MemoryStore;
    const result = buildStablePrefix(brokenStore);
    expect(result.stablePrefix).toBe("");
    expect(result.entryCount).toBe(0);
  });
});

describe("toAnthropicCachedBlocks", () => {
  it("emits a single cache_control block for non-empty prefix", () => {
    const blocks = toAnthropicCachedBlocks("## Stable Memory\n- User: foo");
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.type).toBe("text");
    expect(blocks[0]!.cache_control.type).toBe("ephemeral");
    expect(blocks[0]!.text).toContain("## Stable Memory");
  });

  it("returns [] for empty prefix (caller can concat unconditionally)", () => {
    const blocks = toAnthropicCachedBlocks("");
    expect(blocks).toEqual([]);
  });
});

describe("openaiMinimumStablePrefixChars", () => {
  it("returns the OpenAI prefix-cache floor in characters", () => {
    expect(openaiMinimumStablePrefixChars()).toBeGreaterThanOrEqual(2048);
  });
});
