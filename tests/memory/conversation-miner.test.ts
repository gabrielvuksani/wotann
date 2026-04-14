import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AutoCaptureEntry } from "../../src/memory/store.js";
import { ConversationMiner } from "../../src/memory/conversation-miner.js";
import type { MiningResult } from "../../src/memory/conversation-miner.js";

// ---------------------------------------------------------------------------
// Mock MemoryStore — tracks calls without hitting SQLite
// ---------------------------------------------------------------------------

interface InsertCall {
  readonly id: string;
  readonly layer: string;
  readonly blockType: string;
  readonly key: string;
  readonly value: string;
  readonly domain?: string;
  readonly topic?: string;
}

interface VerbatimCall {
  readonly rawContent: string;
  readonly domain?: string;
  readonly topic?: string;
  readonly sessionId?: string;
}

function createMockStore() {
  const insertCalls: InsertCall[] = [];
  const verbatimCalls: VerbatimCall[] = [];

  const store = {
    insert: vi.fn((entry: Record<string, unknown>) => {
      insertCalls.push({
        id: entry["id"] as string,
        layer: entry["layer"] as string,
        blockType: entry["blockType"] as string,
        key: entry["key"] as string,
        value: entry["value"] as string,
        domain: entry["domain"] as string | undefined,
        topic: entry["topic"] as string | undefined,
      });
    }),
    storeVerbatim: vi.fn(
      (rawContent: string, options?: Record<string, unknown>) => {
        verbatimCalls.push({
          rawContent,
          domain: options?.["domain"] as string | undefined,
          topic: options?.["topic"] as string | undefined,
          sessionId: options?.["sessionId"] as string | undefined,
        });
        return "mock-verbatim-id";
      },
    ),
    search: vi.fn(() => []),
  };

  return { store, insertCalls, verbatimCalls };
}

// ---------------------------------------------------------------------------
// mineClaudeExport
// ---------------------------------------------------------------------------

describe("ConversationMiner.mineClaudeExport", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let miner: ConversationMiner;

  beforeEach(() => {
    mockStore = createMockStore();
    // Cast the mock to MemoryStore since we only use insert/storeVerbatim/search
    miner = new ConversationMiner(mockStore.store as never);
  });

  it("parses valid Claude JSON and stores verbatim chunks", () => {
    const json = JSON.stringify([
      { role: "user", content: "How do I configure the database?" },
      { role: "assistant", content: "You can configure it in wotann.yaml under the database section." },
    ]);

    const result = miner.mineClaudeExport(json);

    expect(result.verbatimStored).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
    expect(mockStore.store.storeVerbatim).toHaveBeenCalled();
  });

  it("extracts decision observations from Claude messages", () => {
    const json = JSON.stringify([
      { role: "user", content: "Should we use Postgres or MySQL?" },
      { role: "assistant", content: "I decided to go with Postgres because of JSONB support." },
    ]);

    const result = miner.mineClaudeExport(json);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    expect(result.entriesCreated).toBeGreaterThanOrEqual(1);
    const decisionEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Decision:"));
    expect(decisionEntry).toBeDefined();
    expect(decisionEntry!.blockType).toBe("decisions");
  });

  it("detects database domain from message content", () => {
    const json = JSON.stringify([
      { role: "user", content: "The postgres migration failed with a schema error" },
    ]);

    const result = miner.mineClaudeExport(json);

    expect(result.domainsDetected).toContain("database");
  });

  it("returns error for invalid JSON", () => {
    const result = miner.mineClaudeExport("not valid json{{{");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse Claude export");
    expect(result.entriesCreated).toBe(0);
    expect(result.verbatimStored).toBe(0);
  });

  it("returns error when JSON is not an array", () => {
    const result = miner.mineClaudeExport(JSON.stringify({ role: "user", content: "hello" }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("must be a JSON array");
  });

  it("returns empty result for empty message array", () => {
    const result = miner.mineClaudeExport(JSON.stringify([]));

    expect(result.entriesCreated).toBe(0);
    expect(result.verbatimStored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("detects topics from content keywords", () => {
    const json = JSON.stringify([
      { role: "user", content: "We need to refactor the authentication module to improve performance" },
    ]);

    const result = miner.mineClaudeExport(json);

    // "refactoring" or "performance" should be detected
    expect(result.topicsDetected.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// mineSlackExport
// ---------------------------------------------------------------------------

describe("ConversationMiner.mineSlackExport", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let miner: ConversationMiner;

  beforeEach(() => {
    mockStore = createMockStore();
    miner = new ConversationMiner(mockStore.store as never);
  });

  it("parses valid Slack JSON and stores verbatim chunks", () => {
    const json = JSON.stringify([
      { user: "U123", text: "The deploy to staging failed with a timeout error", ts: "1700000000.000001" },
      { user: "U456", text: "I prefer using blue-green deploys to avoid downtime", ts: "1700000001.000001" },
    ]);

    const result = miner.mineSlackExport(json);

    expect(result.verbatimStored).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts problem observations from Slack messages", () => {
    const json = JSON.stringify([
      { user: "U123", text: "Error: ECONNREFUSED when connecting to the database", ts: "1700000000.000001" },
    ]);

    const result = miner.mineSlackExport(json);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const problemEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Problem:"));
    expect(problemEntry).toBeDefined();
    expect(problemEntry!.blockType).toBe("issues");
  });

  it("extracts preference observations from Slack messages", () => {
    const json = JSON.stringify([
      { user: "U789", text: "I always use immutable patterns to prevent side effects", ts: "1700000002.000001" },
    ]);

    const result = miner.mineSlackExport(json);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const prefEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Preference:"));
    expect(prefEntry).toBeDefined();
    expect(prefEntry!.blockType).toBe("patterns");
  });

  it("returns error for invalid Slack JSON", () => {
    const result = miner.mineSlackExport("broken json!!!");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse Slack export");
  });

  it("returns error when Slack messages lack required fields", () => {
    const result = miner.mineSlackExport(JSON.stringify([{ user: "U1" }]));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("missing user/text/ts");
  });

  it("returns empty result for empty Slack array", () => {
    const result = miner.mineSlackExport(JSON.stringify([]));

    expect(result.entriesCreated).toBe(0);
    expect(result.verbatimStored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mineGenericText
// ---------------------------------------------------------------------------

describe("ConversationMiner.mineGenericText", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let miner: ConversationMiner;

  beforeEach(() => {
    mockStore = createMockStore();
    miner = new ConversationMiner(mockStore.store as never);
  });

  it("splits text by paragraphs and stores verbatim", () => {
    const text = [
      "The authentication system uses JWT tokens for session management.",
      "",
      "We chose OAuth2 over basic auth because it supports third-party providers.",
      "",
      "All API routes require a valid bearer token in the Authorization header.",
    ].join("\n");

    const result = miner.mineGenericText(text, "meeting-notes");

    expect(result.verbatimStored).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts decision observations from text", () => {
    const text = "We decided to use SQLite instead of Postgres for the local memory store.";

    const result = miner.mineGenericText(text);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const decisionEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Decision:"));
    expect(decisionEntry).toBeDefined();
  });

  it("extracts fact observations from text", () => {
    const text = "The memory system works by storing observations in FTS5 tables for full-text search.";

    const result = miner.mineGenericText(text);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const factEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Fact:"));
    expect(factEntry).toBeDefined();
    expect(factEntry!.blockType).toBe("patterns");
  });

  it("detects domain from file paths in text", () => {
    const text = "The file at src/memory/store.ts contains the SQLite schema definitions.";

    const result = miner.mineGenericText(text);

    expect(result.domainsDetected).toContain("memory");
  });

  it("skips chunks shorter than minChunkSize", () => {
    const minerStrict = new ConversationMiner(mockStore.store as never, { minChunkSize: 100 });
    const text = "Short.";

    const result = minerStrict.mineGenericText(text);

    expect(result.verbatimStored).toBe(0);
    expect(result.entriesCreated).toBe(0);
  });

  it("returns empty result for empty text", () => {
    const result = miner.mineGenericText("");

    expect(result.entriesCreated).toBe(0);
    expect(result.verbatimStored).toBe(0);
  });

  it("respects maxChunkSize by splitting large text", () => {
    const minerSmall = new ConversationMiner(mockStore.store as never, { maxChunkSize: 100 });
    // Create text with multiple paragraphs that exceed 100 chars each
    const para = "This is a paragraph that contains enough text to demonstrate chunking behavior for mining.";
    const text = `${para}\n\n${para}\n\n${para}`;

    const result = minerSmall.mineGenericText(text);

    expect(result.verbatimStored).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// mineAutoCaptureEntries
// ---------------------------------------------------------------------------

describe("ConversationMiner.mineAutoCaptureEntries", () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let miner: ConversationMiner;

  beforeEach(() => {
    mockStore = createMockStore();
    miner = new ConversationMiner(mockStore.store as never);
  });

  function makeCapture(overrides: Partial<AutoCaptureEntry> & { id: number }): AutoCaptureEntry {
    return {
      eventType: "tool_call",
      content: "",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("mines auto-capture entries and stores verbatim", () => {
    const entries: AutoCaptureEntry[] = [
      makeCapture({ id: 1, content: "Ran vitest on src/memory/store.ts — all tests passed successfully" }),
      makeCapture({ id: 2, content: "User chose to deploy with Docker instead of bare metal" }),
    ];

    const result = miner.mineAutoCaptureEntries(entries);

    expect(result.verbatimStored).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts problem observations from auto-capture", () => {
    const entries: AutoCaptureEntry[] = [
      makeCapture({
        id: 1,
        eventType: "error",
        content: "TypeError: Cannot read properties of undefined at src/memory/store.ts:42",
      }),
    ];

    const result = miner.mineAutoCaptureEntries(entries);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const problemEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Problem:"));
    expect(problemEntry).toBeDefined();
    expect(problemEntry!.blockType).toBe("issues");
  });

  it("extracts decision observations from auto-capture", () => {
    const entries: AutoCaptureEntry[] = [
      makeCapture({
        id: 1,
        content: "Switched to vitest from jest because it is faster with ESM",
      }),
    ];

    const result = miner.mineAutoCaptureEntries(entries);

    expect(result.observationsExtracted).toBeGreaterThanOrEqual(1);
    const decisionEntry = mockStore.insertCalls.find((c) => c.key.startsWith("Decision:"));
    expect(decisionEntry).toBeDefined();
  });

  it("skips entries with content shorter than minChunkSize", () => {
    const entries: AutoCaptureEntry[] = [
      makeCapture({ id: 1, content: "ok" }),
    ];

    const result = miner.mineAutoCaptureEntries(entries);

    expect(result.verbatimStored).toBe(0);
    expect(result.entriesCreated).toBe(0);
  });

  it("returns empty result for empty entries array", () => {
    const result = miner.mineAutoCaptureEntries([]);

    expect(result.entriesCreated).toBe(0);
    expect(result.verbatimStored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("detects domain from file paths in auto-capture content", () => {
    const entries: AutoCaptureEntry[] = [
      makeCapture({
        id: 1,
        content: "Reading file at src/providers/openai.ts to check model configuration",
      }),
    ];

    const result = miner.mineAutoCaptureEntries(entries);

    expect(result.domainsDetected).toContain("providers");
  });

  it("uses sessionId from config when mining", () => {
    const minerWithSession = new ConversationMiner(
      mockStore.store as never,
      { sessionId: "test-session-42" },
    );

    const entries: AutoCaptureEntry[] = [
      makeCapture({ id: 1, content: "Some content long enough to be mined as a valid chunk" }),
    ];

    minerWithSession.mineAutoCaptureEntries(entries);

    expect(mockStore.verbatimCalls[0]?.sessionId).toBe("test-session-42");
  });
});

// ---------------------------------------------------------------------------
// MiningResult immutability
// ---------------------------------------------------------------------------

describe("MiningResult immutability", () => {
  it("returns readonly arrays that cannot be mutated", () => {
    const mockStore = createMockStore();
    const miner = new ConversationMiner(mockStore.store as never);

    const result: MiningResult = miner.mineGenericText("Test content that is long enough to mine properly.");

    // TypeScript enforces readonly at compile time, but we verify structure
    expect(Array.isArray(result.domainsDetected)).toBe(true);
    expect(Array.isArray(result.topicsDetected)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.entriesCreated).toBe("number");
    expect(typeof result.verbatimStored).toBe("number");
    expect(typeof result.observationsExtracted).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// MinerConfig
// ---------------------------------------------------------------------------

describe("MinerConfig defaults", () => {
  it("uses default config values when none provided", () => {
    const mockStore = createMockStore();
    const miner = new ConversationMiner(mockStore.store as never);

    // Mine text that should be processed with defaults (maxChunkSize=2000, minChunkSize=20)
    const text = "This is a paragraph that is definitely longer than 20 characters for default minChunkSize.";
    const result = miner.mineGenericText(text);

    expect(result.verbatimStored).toBe(1);
  });

  it("respects custom defaultDomain in config", () => {
    const mockStore = createMockStore();
    const miner = new ConversationMiner(
      mockStore.store as never,
      { defaultDomain: "custom-domain" },
    );

    // Content without domain signals falls back to defaultDomain
    const text = "A standalone paragraph about general stuff that does not have relevant words.";
    miner.mineGenericText(text);

    expect(mockStore.verbatimCalls[0]?.domain).toBe("custom-domain");
  });
});
