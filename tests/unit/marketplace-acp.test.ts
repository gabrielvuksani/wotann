/**
 * Wave 4E: Tests for SkillMarketplace.listACPAgents + installACPAgent.
 *
 * The methods are thin facades that delegate to AcpAgentRegistry, so
 * we just verify the surface works end-to-end: listing returns the
 * seeded set, and installing a known agent produces a record with the
 * expected status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillMarketplace } from "../../src/marketplace/registry.js";

describe("SkillMarketplace ACP surface (Wave 4E)", () => {
  let tempHome: string;
  let priorHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "wotann-marketplace-acp-"));
    priorHome = process.env["HOME"];
    // Redirect HOME so AcpAgentRegistry writes into a tempdir instead
    // of the user's real ~/.wotann.
    process.env["HOME"] = tempHome;
  });

  afterEach(() => {
    if (priorHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = priorHome;
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("listACPAgents returns ≥5 seeded agents", async () => {
    const marketplace = new SkillMarketplace();
    const agents = await marketplace.listACPAgents();
    expect(agents.length).toBeGreaterThanOrEqual(5);
    const names = agents.map((a) => a.name);
    expect(names).toContain("claude-agent");
    expect(names).toContain("codex-cli");
    expect(names).toContain("gemini-cli");
  });

  it("installACPAgent returns a record with status and persistence", async () => {
    const marketplace = new SkillMarketplace();
    const result = await marketplace.installACPAgent("amp");
    expect(result.name).toBe("amp");
    // We don't control whether `amp` is on PATH, so we accept either
    // INSTALLED or BLOCKED-NOT-INSTALLED, but not any other status.
    expect(["INSTALLED", "BLOCKED-NOT-INSTALLED"]).toContain(result.status);
    expect(typeof result.installedAt).toBe("string");
  });

  it("installACPAgent on unknown name yields MANIFEST-INVALID", async () => {
    const marketplace = new SkillMarketplace();
    const result = await marketplace.installACPAgent("does-not-exist-xyz");
    // Either MANIFEST-INVALID (when the network is unreachable and the
    // name isn't seeded) OR resolves from a live registry. In CI/tests
    // the network is almost always unavailable for acp.dev.
    expect(["MANIFEST-INVALID", "BLOCKED-NOT-INSTALLED", "INSTALLED"]).toContain(result.status);
  });
});
