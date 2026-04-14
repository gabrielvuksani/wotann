/**
 * Integration test: memory store → FTS5 search → decision log → audit trail.
 * Tests the full memory/observability pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/memory/store.js";
import { AuditTrail } from "../../src/telemetry/audit-trail.js";

describe("Integration: Memory + Audit Pipeline", () => {
  let tempDir: string;
  let memStore: MemoryStore;
  let audit: AuditTrail;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-int-mem-"));
    memStore = new MemoryStore(join(tempDir, "memory.db"));
    audit = new AuditTrail(join(tempDir, "audit.db"));
  });

  afterEach(() => {
    memStore.close();
    audit.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores a decision and retrieves it via FTS5 search", () => {
    // Store a decision
    memStore.logDecision({
      id: "d1",
      decision: "Use SQLite instead of PostgreSQL for memory",
      rationale: "Zero config, local-first, FTS5 support",
      alternatives: "PostgreSQL, MongoDB",
      constraints: "Must work offline without server",
    });

    // Store a related memory entry
    memStore.memoryInsert("decisions", "db-choice", "Chose SQLite for local-first architecture with FTS5 full-text search");

    // Search should find it
    const results = memStore.search("SQLite");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.entry.value).toContain("SQLite");
  });

  it("memory replace + search roundtrip", () => {
    memStore.memoryReplace("user", "timezone", "America/New_York");
    memStore.memoryReplace("user", "role", "Full Stack Developer");

    const results = memStore.search("Developer");
    expect(results.length).toBeGreaterThan(0);

    // Replace should update, not duplicate
    memStore.memoryReplace("user", "role", "Senior Full Stack Developer");
    const userEntries = memStore.getByBlock("user");
    const roleEntries = userEntries.filter((e) => e.key === "role");
    expect(roleEntries).toHaveLength(1);
    expect(roleEntries[0]!.value).toContain("Senior");
  });

  it("audit trail records and queries actions", () => {
    // Simulate a series of agent actions
    audit.record({
      id: "a1", sessionId: "s1", timestamp: "2026-04-01T10:00:00Z",
      tool: "Read", riskLevel: "low", success: true,
      input: "/src/index.ts", durationMs: 50,
    });
    audit.record({
      id: "a2", sessionId: "s1", timestamp: "2026-04-01T10:01:00Z",
      tool: "Edit", riskLevel: "medium", success: true,
      input: "/src/auth.ts", tokensUsed: 500, costUsd: 0.0015,
    });
    audit.record({
      id: "a3", sessionId: "s1", timestamp: "2026-04-01T10:02:00Z",
      tool: "Bash", riskLevel: "high", success: false,
      input: "npm test", output: "3 tests failed",
    });

    // Query all
    expect(audit.getCount()).toBe(3);

    // Query by tool
    const edits = audit.query({ tool: "Edit" });
    expect(edits).toHaveLength(1);
    expect(edits[0]!.costUsd).toBeCloseTo(0.0015);

    // Query failures
    const failures = audit.query({}).filter((e) => !e.success);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.tool).toBe("Bash");

    // Integrity check
    expect(audit.verifyIntegrity("a1")).toBe(true);
    expect(audit.verifyIntegrity("a2")).toBe(true);
  });

  it("memory + audit work together for session reconstruction", () => {
    // Agent works on auth module
    audit.record({
      id: "act-1", sessionId: "s-auth", timestamp: "2026-04-01T10:00:00Z",
      tool: "Read", riskLevel: "low", success: true, input: "src/auth.ts",
    });

    memStore.memoryInsert("patterns", "auth-pattern", "Token refresh uses interceptor pattern with retry");

    audit.record({
      id: "act-2", sessionId: "s-auth", timestamp: "2026-04-01T10:05:00Z",
      tool: "Edit", riskLevel: "medium", success: true, input: "src/auth.ts",
    });

    // Can reconstruct what happened
    const sessionActions = audit.query({ sessionId: "s-auth" });
    expect(sessionActions).toHaveLength(2);

    const patterns = memStore.search("interceptor");
    expect(patterns.length).toBeGreaterThan(0);
  });
});
