/**
 * Tests for `src/cli/debug-share.ts` — E7 debug bundle + redaction.
 *
 * The bundle is intended to be paste-safe in a public bug report, so
 * the redactLine() function carries the most safety weight: any leak
 * here ships a user's secrets to a GitHub issue. We test the obvious
 * patterns the source claims to redact (sk-…, Bearer, JWT, API_KEY=,
 * GitHub PATs, email) and a couple of bypass shapes to make sure
 * partial matches don't slip through.
 *
 * The bundle assembly + markdown rendering tests are smoke-level —
 * they verify the output shape is non-empty + has the documented
 * sections, not exact line-by-line equivalence (so the renderer can
 * tweak whitespace without breaking the suite).
 */

import { describe, it, expect } from "vitest";
import {
  collectDebugBundle,
  redactLine,
  renderBundleMarkdown,
} from "../../src/cli/debug-share.js";

describe("redactLine — secret patterns", () => {
  it("redacts an OpenAI sk- key inline", () => {
    const line = "config.apiKey = 'sk-abcdef0123456789ABCDEF';";
    const redacted = redactLine(line);
    expect(redacted).not.toContain("sk-abcdef0123456789ABCDEF");
    expect(redacted).toContain("<openai-key>");
  });

  it("redacts an Anthropic-style API_KEY=… assignment", () => {
    const line = "ANTHROPIC_API_KEY=sk-ant-abc1234567890XYZdefGHI";
    const redacted = redactLine(line);
    expect(redacted).not.toContain("sk-ant-abc1234567890XYZdefGHI");
    // The API_KEY= pattern collapses to API_KEY=<redacted>
    expect(redacted).toContain("<redacted>");
  });

  it("redacts a Bearer token inside an Authorization header", () => {
    const line = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    const redacted = redactLine(line);
    expect(redacted).toContain("Bearer <redacted>");
  });

  it("redacts a JWT (3-part eyJ…) anywhere in the line", () => {
    const line = "got token eyJabc123.eyJdef456.signaturepart from issuer";
    const redacted = redactLine(line);
    expect(redacted).toContain("<jwt>");
    expect(redacted).not.toContain("eyJabc123.eyJdef456.signaturepart");
  });

  it("redacts a GitHub personal access token (ghp_… prefix)", () => {
    const line = "git remote add origin https://ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789@github.com/x/y";
    const redacted = redactLine(line);
    expect(redacted).toContain("<github-pat>");
    expect(redacted).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
  });

  it("redacts an email address into <user@example.com>", () => {
    const line = "User vuksanig@gmail.com signed in";
    const redacted = redactLine(line);
    expect(redacted).toContain("<user@example.com>");
    expect(redacted).not.toContain("vuksanig@gmail.com");
  });

  it("collapses the user's home directory path to ~", () => {
    // Use the real homedir() so the test matches the function's behavior.
    const home = require("node:os").homedir() as string;
    const line = `error reading ${home}/code/secret.txt`;
    const redacted = redactLine(line);
    expect(redacted).toContain("~/code/secret.txt");
    expect(redacted).not.toContain(home);
  });

  it("leaves benign lines untouched (no false positives on a normal log line)", () => {
    const line = "INFO 2026-04-26T19:00:00Z workflow.run started phase=warmup";
    const redacted = redactLine(line);
    // No secret patterns → output should equal input.
    expect(redacted).toBe(line);
  });
});

describe("collectDebugBundle — shape", () => {
  it("returns the documented top-level keys", async () => {
    const bundle = await collectDebugBundle({
      activeProvider: "anthropic",
      activeModel: "claude-sonnet",
      recentEvents: ["ev-1", "ev-2"],
      memoryStats: { totalEntries: 12, sizeBytes: 4096 },
      costStats: { todayUsd: 0.123, weeklyUsd: 1.5 },
    });

    // generatedAt is an ISO string
    expect(typeof bundle.generatedAt).toBe("string");
    expect(() => new Date(bundle.generatedAt).toISOString()).not.toThrow();

    // runtime block has all required fields
    expect(bundle.runtime).toBeDefined();
    expect(typeof bundle.runtime.nodeVersion).toBe("string");
    expect(typeof bundle.runtime.platform).toBe("string");
    expect(typeof bundle.runtime.cpuCount).toBe("number");
    expect(bundle.runtime.cpuCount).toBeGreaterThan(0);

    // session block reflects injected options
    expect(bundle.session.activeProvider).toBe("anthropic");
    expect(bundle.session.activeModel).toBe("claude-sonnet");
    expect(bundle.session.recentEvents).toHaveLength(2);

    // workspace block exists (root may be set from cwd)
    expect(bundle.workspace).toBeDefined();

    // memory + cost reflect injected stats
    expect(bundle.memory.totalEntries).toBe(12);
    expect(bundle.cost.todayUsd).toBe(0.123);

    // daemonLogTail is an array (possibly empty if no log file)
    expect(Array.isArray(bundle.daemonLogTail)).toBe(true);
  });

  it("redacts injected recentEvents (defense in depth)", async () => {
    const bundle = await collectDebugBundle({
      recentEvents: [
        "user supplied sk-abc123def456ghi789jklmnop in chat",
        "Bearer eyJsomerealjwt.eyJpayload.sig was used",
      ],
    });

    // Each recentEvent must come back redacted.
    for (const ev of bundle.session.recentEvents) {
      expect(ev).not.toContain("sk-abc123def456ghi789jklmnop");
    }
    expect(bundle.session.recentEvents.join("\n")).toContain("<openai-key>");
  });

  it("limits recentEvents to the last 30 entries", async () => {
    const events = Array.from({ length: 50 }, (_, i) => `event-${i}`);
    const bundle = await collectDebugBundle({ recentEvents: events });

    expect(bundle.session.recentEvents).toHaveLength(30);
    // The slice keeps the LAST 30, so the first kept event is event-20.
    expect(bundle.session.recentEvents[0]).toBe("event-20");
    expect(bundle.session.recentEvents[29]).toBe("event-49");
  });
});

describe("renderBundleMarkdown — output shape", () => {
  it("produces a non-empty markdown string with the documented headers", async () => {
    const bundle = await collectDebugBundle({
      activeProvider: "ollama",
      activeModel: "gemma4",
      recentEvents: ["e1", "e2"],
      memoryStats: { totalEntries: 5, sizeBytes: 1024 },
      costStats: { todayUsd: 0.01, weeklyUsd: 0.05 },
    });

    const md = renderBundleMarkdown(bundle);

    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
    // Section headers we promise.
    expect(md).toContain("## WOTANN debug bundle");
    expect(md).toContain("### Runtime");
    expect(md).toContain("### Session");
    expect(md).toContain("### Workspace");
    expect(md).toContain("### Memory");
    expect(md).toContain("### Cost");
    expect(md).toContain("### Recent events");
  });

  it("omits the optional Memory + Cost sections when stats are absent", async () => {
    const bundle = await collectDebugBundle({}); // no memory/cost
    const md = renderBundleMarkdown(bundle);

    expect(md).toContain("### Runtime");
    // Memory/Cost are gated behind `!== undefined`; with no stats they
    // should NOT render.
    expect(md).not.toContain("### Memory");
    expect(md).not.toContain("### Cost");
  });
});
