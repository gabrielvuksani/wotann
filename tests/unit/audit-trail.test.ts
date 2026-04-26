import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditTrail } from "../../src/telemetry/audit-trail.js";
import { getTierModel } from "../_helpers/model-tier.js";

describe("Audit Trail", () => {
  let trail: AuditTrail;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-audit-test-"));
    trail = new AuditTrail(join(tempDir, "audit.db"));
  });

  afterEach(() => {
    trail.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("records an action", () => {
    trail.record({
      id: "act-1",
      sessionId: "s1",
      timestamp: "2026-04-01T12:00:00Z",
      tool: "Read",
      riskLevel: "low",
      success: true,
    });

    expect(trail.getCount()).toBe(1);
  });

  it("queries by tool name", () => {
    trail.record({ id: "a1", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z", tool: "Read", riskLevel: "low", success: true });
    trail.record({ id: "a2", sessionId: "s1", timestamp: "2026-04-01T12:01:00Z", tool: "Write", riskLevel: "medium", success: true });
    trail.record({ id: "a3", sessionId: "s1", timestamp: "2026-04-01T12:02:00Z", tool: "Read", riskLevel: "low", success: true });

    const reads = trail.query({ tool: "Read" });
    expect(reads.length).toBe(2);
    expect(reads.every((e) => e.tool === "Read")).toBe(true);
  });

  it("queries by date prefix", () => {
    trail.record({ id: "a1", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z", tool: "Read", riskLevel: "low", success: true });
    trail.record({ id: "a2", sessionId: "s1", timestamp: "2026-04-02T12:00:00Z", tool: "Read", riskLevel: "low", success: true });

    const day1 = trail.query({ date: "2026-04-01" });
    expect(day1.length).toBe(1);
    expect(day1[0]!.id).toBe("a1");
  });

  it("queries by session ID", () => {
    trail.record({ id: "a1", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z", tool: "Read", riskLevel: "low", success: true });
    trail.record({ id: "a2", sessionId: "s2", timestamp: "2026-04-01T12:00:00Z", tool: "Read", riskLevel: "low", success: true });

    const s1Results = trail.query({ sessionId: "s1" });
    expect(s1Results.length).toBe(1);
  });

  it("queries by risk level", () => {
    trail.record({ id: "a1", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z", tool: "Bash", riskLevel: "high", success: true });
    trail.record({ id: "a2", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z", tool: "Read", riskLevel: "low", success: true });

    const highRisk = trail.query({ riskLevel: "high" });
    expect(highRisk.length).toBe(1);
    expect(highRisk[0]!.tool).toBe("Bash");
  });

  it("records token usage and cost", () => {
    // PROVIDER-AGNOSTIC: model id is round-tripped audit data, not asserted
    // for behavior. Wave DH-3: tier helper.
    const { provider: prov, model: mdl } = getTierModel("balanced");
    trail.record({
      id: "a1", sessionId: "s1", timestamp: "2026-04-01T12:00:00Z",
      tool: "Query", riskLevel: "medium", success: true,
      tokensUsed: 1500, costUsd: 0.045, durationMs: 2300,
      model: mdl, provider: prov,
    });

    const entries = trail.query({ tool: "Query" });
    expect(entries[0]!.tokensUsed).toBe(1500);
    expect(entries[0]!.costUsd).toBeCloseTo(0.045);
    expect(entries[0]!.model).toBe(mdl);
  });

  it("verifies entry integrity", () => {
    trail.record({
      id: "integrity-test", sessionId: "s1",
      timestamp: "2026-04-01T12:00:00Z", tool: "Read",
      riskLevel: "low", success: true,
    });

    expect(trail.verifyIntegrity("integrity-test")).toBe(true);
    expect(trail.verifyIntegrity("nonexistent")).toBe(false);
  });

  it("respects query limit", () => {
    for (let i = 0; i < 50; i++) {
      trail.record({
        id: `a${i}`, sessionId: "s1",
        timestamp: `2026-04-01T12:${String(i).padStart(2, "0")}:00Z`,
        tool: "Read", riskLevel: "low", success: true,
      });
    }

    const limited = trail.query({ limit: 10 });
    expect(limited.length).toBe(10);
  });

  it("is append-only (no update/delete methods)", () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(trail));
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });
});
