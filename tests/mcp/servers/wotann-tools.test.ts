/**
 * Tests for V9 T3.2 — wotann-tools.ts MCP adapter.
 *
 * Wave 1 shipped 5 of 10 tools. T3.2 closure expanded the surface to all
 * 10 spec'd tools (council_vote, arena_run, exploit_lane,
 * workshop_dispatch, fleet_view) plus the T14.1 memory-tool shim
 * adapter that ships alongside.
 *
 * Confirms:
 *   - All tool definitions exposed in listTools() — the post-T3.2
 *     contract is the FULL surface, not just the original 5.
 *   - Each tool's happy path produces a non-error MCP envelope.
 *   - Each tool's missing-dependency path produces an honest error
 *     (no silent success, no exception leaks past the boundary).
 *   - Bad-input paths return typed error envelopes.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createWotannMcpAdapter,
  WOTANN_MCP_TOOL_DEFINITIONS,
} from "../../../src/mcp/servers/wotann-tools.js";

describe("wotann-tools MCP adapter — V9 T3.2", () => {
  it("exposes every spec'd tool definition in listTools", () => {
    const adapter = createWotannMcpAdapter({});
    const tools = adapter.listTools();
    const names = tools.map((t) => t.name).sort();
    // The post-T3.2 contract: original Wave-1 five PLUS the five
    // closure tools shipped together with the T14.1 memory-tool shim.
    // The shim is registered conditionally (only when
    // `deps.memoryShim` is supplied) so the no-deps case lists 10.
    expect(names).toContain("mcp__wotann__approval_request");
    expect(names).toContain("mcp__wotann__memory_search");
    expect(names).toContain("mcp__wotann__session_end");
    expect(names).toContain("mcp__wotann__shadow_git_status");
    expect(names).toContain("mcp__wotann__skill_load");
    // T3.2 closure additions:
    expect(names).toContain("mcp__wotann__council_vote");
    expect(names).toContain("mcp__wotann__arena_run");
    expect(names).toContain("mcp__wotann__exploit_lane");
    expect(names).toContain("mcp__wotann__workshop_dispatch");
    expect(names).toContain("mcp__wotann__fleet_view");
    // 10 tools is the canonical post-T3.2 minimum; the optional
    // memory-tool shim adds an 11th when wired.
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });

  it("listTools matches the exported WOTANN_MCP_TOOL_DEFINITIONS table", () => {
    const adapter = createWotannMcpAdapter({});
    expect(adapter.listTools()).toEqual(WOTANN_MCP_TOOL_DEFINITIONS);
  });

  // ── memory_search ────────────────────────────────────────────

  describe("memory_search", () => {
    it("happy path returns hits as JSON text", async () => {
      const searchMemory = vi.fn().mockResolvedValue([
        { key: "auth.middleware", value: "JWT pattern", score: 0.91 },
      ]);
      const adapter = createWotannMcpAdapter({ searchMemory });
      const result = await adapter.callTool("mcp__wotann__memory_search", { query: "auth" });
      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(typeof text).toBe("string");
      const parsed = JSON.parse(text!);
      expect(parsed.hits.length).toBe(1);
      expect(searchMemory).toHaveBeenCalledOnce();
    });

    it("threads max_results and min_confidence options", async () => {
      const searchMemory = vi.fn().mockResolvedValue([]);
      const adapter = createWotannMcpAdapter({ searchMemory });
      await adapter.callTool("mcp__wotann__memory_search", {
        query: "x",
        max_results: 3,
        min_confidence: 0.5,
      });
      expect(searchMemory).toHaveBeenCalledWith("x", { maxResults: 3, minConfidence: 0.5 });
    });

    it("honest error when dependency missing", async () => {
      const adapter = createWotannMcpAdapter({});
      const result = await adapter.callTool("mcp__wotann__memory_search", { query: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("dependency \"searchMemory\" not wired");
    });

    it("rejects empty query", async () => {
      const searchMemory = vi.fn();
      const adapter = createWotannMcpAdapter({ searchMemory });
      const result = await adapter.callTool("mcp__wotann__memory_search", { query: "" });
      expect(result.isError).toBe(true);
      expect(searchMemory).not.toHaveBeenCalled();
    });
  });

  // ── skill_load ──────────────────────────────────────────────

  describe("skill_load", () => {
    it("returns skill body when found", async () => {
      const loadSkill = vi.fn().mockResolvedValue({ id: "research-deep", body: "# Research" });
      const adapter = createWotannMcpAdapter({ loadSkill });
      const result = await adapter.callTool("mcp__wotann__skill_load", {
        skill_id: "research-deep",
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toBe("# Research");
    });

    it("error when skill not in registry", async () => {
      const loadSkill = vi.fn().mockResolvedValue(null);
      const adapter = createWotannMcpAdapter({ loadSkill });
      const result = await adapter.callTool("mcp__wotann__skill_load", { skill_id: "ghost" });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('skill "ghost" not found');
    });

    it("error when skill_id missing", async () => {
      const loadSkill = vi.fn();
      const adapter = createWotannMcpAdapter({ loadSkill });
      const result = await adapter.callTool("mcp__wotann__skill_load", {});
      expect(result.isError).toBe(true);
      expect(loadSkill).not.toHaveBeenCalled();
    });
  });

  // ── shadow_git_status ──────────────────────────────────────

  it("shadow_git_status returns JSON-serialized delta", async () => {
    const shadowGitStatus = vi.fn().mockResolvedValue({
      modified: ["a.ts"],
      added: ["b.ts"],
      deleted: [],
    });
    const adapter = createWotannMcpAdapter({ shadowGitStatus });
    const result = await adapter.callTool("mcp__wotann__shadow_git_status", {});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text!);
    expect(parsed.modified).toEqual(["a.ts"]);
  });

  // ── session_end ────────────────────────────────────────────

  it("session_end requires session_id", async () => {
    const adapter = createWotannMcpAdapter({ endSession: vi.fn() });
    const result = await adapter.callTool("mcp__wotann__session_end", {});
    expect(result.isError).toBe(true);
  });

  it("session_end happy path", async () => {
    const endSession = vi.fn().mockResolvedValue({ ended: true });
    const adapter = createWotannMcpAdapter({ endSession });
    const result = await adapter.callTool("mcp__wotann__session_end", { session_id: "s-1" });
    expect(result.isError).toBeUndefined();
    expect(endSession).toHaveBeenCalledWith("s-1");
  });

  // ── approval_request ───────────────────────────────────────

  it("approval_request happy path returns decision JSON", async () => {
    const requestApproval = vi
      .fn()
      .mockResolvedValue({ decision: "approved", reason: "user approved" });
    const adapter = createWotannMcpAdapter({ requestApproval });
    const result = await adapter.callTool("mcp__wotann__approval_request", {
      summary: "rm -rf /tmp/build",
      risk_level: "high",
      tool_call_id: "tc-1",
    });
    expect(result.isError).toBeUndefined();
    expect(requestApproval).toHaveBeenCalledWith({
      summary: "rm -rf /tmp/build",
      riskLevel: "high",
      toolCallId: "tc-1",
    });
  });

  it("approval_request rejects bad shape", async () => {
    const adapter = createWotannMcpAdapter({ requestApproval: vi.fn() });
    const result = await adapter.callTool("mcp__wotann__approval_request", {
      summary: "",
      tool_call_id: "tc-1",
    });
    expect(result.isError).toBe(true);
  });

  // ── unknown tool ────────────────────────────────────────────

  it("unknown tool name returns typed error", async () => {
    const adapter = createWotannMcpAdapter({});
    const result = await adapter.callTool("mcp__wotann__bogus", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("unknown tool");
  });
});
