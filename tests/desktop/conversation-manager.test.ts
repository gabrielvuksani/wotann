import { describe, it, expect } from "vitest";
import {
  createConversation,
  addMessage,
  deleteMessage,
  pinConversation,
  archiveConversation,
  tagConversation,
  untagConversation,
  renameConversation,
  forkConversation,
  searchConversations,
  toSummary,
  getSortedSummaries,
  generateTitle,
  generateId,
} from "../../src/desktop/conversation-manager.js";
import type { Conversation, DesktopMessage } from "../../src/desktop/conversation-manager.js";

// ── Test Helpers ───────────────────────────────────────

function makeMessage(overrides?: Partial<DesktopMessage>): DesktopMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello",
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Factory Tests ──────────────────────────────────────

describe("createConversation", () => {
  it("should create a conversation with defaults", () => {
    const conv = createConversation();
    expect(conv.id).toMatch(/^conv_/);
    expect(conv.title).toBe("New Conversation");
    expect(conv.messages).toHaveLength(0);
    // S1-18 vendor-bias elimination (commit ad37d2c): when no
    // credentials are discovered (CI without API keys), provider/
    // model resolve to null so the UI can prompt the user instead of
    // silently picking Anthropic. When creds ARE discovered (typical
    // local dev), provider is a non-empty string identifying a
    // known adapter. Stronger than shape: reject empty strings and
    // reject strings that don't match the registered adapter names.
    if (conv.provider === null) {
      expect(conv.provider).toBeNull();
      // Provider+model must BOTH be null together — half-null state
      // would imply the defaulting logic got out of sync.
      expect(conv.model).toBeNull();
    } else {
      expect(typeof conv.provider).toBe("string");
      expect(conv.provider.length).toBeGreaterThan(0);
      // Known provider keys from PROVIDER_DEFAULTS in
      // src/providers/model-defaults.ts. When a new provider is added
      // to that table this list must grow; a drift here signals
      // either this list is stale OR the default-resolution logic
      // picked an unknown provider name.
      expect([
        "anthropic",
        "openai",
        "codex",
        "copilot",
        "gemini",
        "vertex",
        "deepseek",
        "xai",
        "mistral",
        "free",
        "together",
        "fireworks",
        "perplexity",
        "huggingface",
        "azure",
        "bedrock",
        "sambanova",
        "ollama",
        "cerebras",
      ]).toContain(conv.provider);
      // Matching non-null model must be a non-empty string.
      expect(typeof conv.model).toBe("string");
      expect((conv.model ?? "").length).toBeGreaterThan(0);
    }
    expect(conv.pinned).toBe(false);
    expect(conv.archived).toBe(false);
    expect(conv.tags).toHaveLength(0);
    expect(conv.tokenCount).toBe(0);
    expect(conv.cost).toBe(0);
  });

  it("should accept custom options", () => {
    const conv = createConversation({
      provider: "openai",
      model: "gpt-4o",
      mode: "plan",
      project: "proj-1",
      tags: ["test"],
    });
    expect(conv.provider).toBe("openai");
    expect(conv.model).toBe("gpt-4o");
    expect(conv.mode).toBe("plan");
    expect(conv.project).toBe("proj-1");
    expect(conv.tags).toEqual(["test"]);
  });

  it("should generate unique IDs", () => {
    const a = createConversation();
    const b = createConversation();
    expect(a.id).not.toBe(b.id);
  });
});

// ── generateTitle Tests ────────────────────────────────

describe("generateTitle", () => {
  it("should keep short messages as-is", () => {
    expect(generateTitle("Fix the bug")).toBe("Fix the bug");
  });

  it("should truncate long messages to 60 chars", () => {
    const long = "A".repeat(80);
    const title = generateTitle(long);
    expect(title.length).toBe(60);
    expect(title.endsWith("...")).toBe(true);
  });

  it("should replace newlines with spaces", () => {
    expect(generateTitle("line one\nline two")).toBe("line one line two");
  });
});

// ── generateId Tests ───────────────────────────────────

describe("generateId", () => {
  it("should generate IDs with the given prefix", () => {
    expect(generateId("test")).toMatch(/^test_/);
  });

  it("should produce unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("u")));
    expect(ids.size).toBe(100);
  });
});

// ── Message Operations ─────────────────────────────────

describe("addMessage", () => {
  it("should append a message and update timestamp", () => {
    const conv = createConversation();
    const msg = makeMessage({ tokensUsed: 100, cost: 0.01 });
    const updated = addMessage(conv, msg);

    expect(updated.messages).toHaveLength(1);
    expect(updated.tokenCount).toBe(100);
    expect(updated.cost).toBe(0.01);
    expect(updated.updatedAt).toBe(msg.timestamp);
  });

  it("should auto-title from first user message", () => {
    const conv = createConversation();
    const msg = makeMessage({ content: "How do I deploy to AWS?" });
    const updated = addMessage(conv, msg);

    expect(updated.title).toBe("How do I deploy to AWS?");
  });

  it("should not change title for subsequent messages", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ id: "m1", content: "First question" }));
    conv = addMessage(conv, makeMessage({ id: "m2", content: "Follow-up", role: "user" }));

    expect(conv.title).toBe("First question");
  });

  it("should not mutate the original conversation", () => {
    const conv = createConversation();
    const _updated = addMessage(conv, makeMessage());
    expect(conv.messages).toHaveLength(0);
  });

  it("should accumulate tokens and cost", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ id: "m1", tokensUsed: 50, cost: 0.005 }));
    conv = addMessage(conv, makeMessage({ id: "m2", tokensUsed: 100, cost: 0.01 }));

    expect(conv.tokenCount).toBe(150);
    expect(conv.cost).toBeCloseTo(0.015);
  });
});

describe("deleteMessage", () => {
  it("should remove a message and adjust counts", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ id: "m1", tokensUsed: 100, cost: 0.01 }));
    conv = addMessage(conv, makeMessage({ id: "m2", tokensUsed: 50, cost: 0.005 }));

    const updated = deleteMessage(conv, "m1");
    expect(updated.messages).toHaveLength(1);
    expect(updated.tokenCount).toBe(50);
    expect(updated.cost).toBeCloseTo(0.005);
  });
});

// ── Pin/Archive/Tag Operations ─────────────────────────

describe("conversation operations", () => {
  it("should pin a conversation", () => {
    const conv = createConversation();
    const pinned = pinConversation(conv, true);
    expect(pinned.pinned).toBe(true);
    expect(conv.pinned).toBe(false); // original unchanged
  });

  it("should archive a conversation", () => {
    const conv = createConversation();
    const archived = archiveConversation(conv, true);
    expect(archived.archived).toBe(true);
  });

  it("should tag a conversation", () => {
    const conv = createConversation();
    const tagged = tagConversation(conv, "important");
    expect(tagged.tags).toContain("important");
  });

  it("should not duplicate tags", () => {
    let conv = createConversation();
    conv = tagConversation(conv, "important");
    conv = tagConversation(conv, "important");
    expect(conv.tags.filter((t) => t === "important")).toHaveLength(1);
  });

  it("should untag a conversation", () => {
    let conv = createConversation();
    conv = tagConversation(conv, "important");
    conv = untagConversation(conv, "important");
    expect(conv.tags).not.toContain("important");
  });

  it("should rename a conversation", () => {
    const conv = createConversation();
    const renamed = renameConversation(conv, "New Title");
    expect(renamed.title).toBe("New Title");
  });
});

// ── Fork Tests ─────────────────────────────────────────

describe("forkConversation", () => {
  it("should fork at a specific message", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ id: "m1", content: "First", tokensUsed: 10, cost: 0.001 }));
    conv = addMessage(conv, makeMessage({ id: "m2", content: "Second", tokensUsed: 20, cost: 0.002 }));
    conv = addMessage(conv, makeMessage({ id: "m3", content: "Third", tokensUsed: 30, cost: 0.003 }));

    const forked = forkConversation(conv, "m2");
    expect(forked).not.toBeNull();
    expect(forked!.messages).toHaveLength(2);
    expect(forked!.title).toBe("Fork: First");
    expect(forked!.tags).toContain("forked");
    expect(forked!.tokenCount).toBe(30);
    expect(forked!.cost).toBeCloseTo(0.003);
    expect(forked!.id).not.toBe(conv.id);
  });

  it("should return null for non-existent message", () => {
    const conv = createConversation();
    expect(forkConversation(conv, "nope")).toBeNull();
  });
});

// ── Search Tests ───────────────────────────────────────

describe("searchConversations", () => {
  it("should find messages matching the query", () => {
    let conv1 = createConversation();
    conv1 = addMessage(conv1, makeMessage({ id: "m1", content: "Deploy to AWS" }));
    let conv2 = createConversation();
    conv2 = addMessage(conv2, makeMessage({ id: "m2", content: "Fix CSS bug" }));

    const results = searchConversations([conv1, conv2], "aws");
    expect(results).toHaveLength(1);
    expect(results[0]?.messageContent).toBe("Deploy to AWS");
  });

  it("should skip archived conversations", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ content: "searchable" }));
    conv = archiveConversation(conv, true);

    expect(searchConversations([conv], "searchable")).toHaveLength(0);
  });

  it("should be case-insensitive", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ content: "TypeScript is great" }));

    expect(searchConversations([conv], "typescript")).toHaveLength(1);
  });
});

// ── Summary Tests ──────────────────────────────────────

describe("toSummary", () => {
  it("should create a summary from a conversation", () => {
    let conv = createConversation();
    conv = addMessage(conv, makeMessage({ content: "Hello world" }));

    const summary = toSummary(conv);
    expect(summary.id).toBe(conv.id);
    expect(summary.messageCount).toBe(1);
    expect(summary.lastMessage).toBe("Hello world");
  });
});

describe("getSortedSummaries", () => {
  it("should put pinned conversations first", () => {
    const convs: Conversation[] = [
      { ...createConversation(), updatedAt: "2025-01-03T00:00:00.000Z", pinned: false },
      { ...createConversation(), updatedAt: "2025-01-01T00:00:00.000Z", pinned: true },
      { ...createConversation(), updatedAt: "2025-01-02T00:00:00.000Z", pinned: false },
    ];

    const summaries = getSortedSummaries(convs);
    expect(summaries[0]?.pinned).toBe(true);
  });

  it("should exclude archived conversations", () => {
    const convs: Conversation[] = [
      { ...createConversation(), archived: true },
      { ...createConversation(), archived: false },
    ];

    const summaries = getSortedSummaries(convs);
    expect(summaries).toHaveLength(1);
  });
});
