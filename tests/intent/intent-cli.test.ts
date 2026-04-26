/**
 * Tests for the `wotann intent` CLI surface.
 *
 * The CLI module is a pure handler (no commander-level side effects)
 * so each action is a single function returning a structured result.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntentCommand } from "../../src/cli/commands/intent.js";
import { getTierModel } from "../_helpers/model-tier.js";
import type { ByoaValidator } from "../../src/intent/byoa-detector.js";

describe("wotann intent CLI handler", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wotann-intent-cli-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("spec init", () => {
    it("creates SPEC.md in workspace", async () => {
      const result = await runIntentCommand({
        action: "spec-init",
        workspaceRoot: tmp,
      });
      expect(result.success).toBe(true);
      expect(existsSync(join(tmp, "SPEC.md"))).toBe(true);
      expect(result.lines.join("\n")).toMatch(/created|initialized|SPEC\.md/i);
    });
  });

  describe("spec show", () => {
    it("prints existing spec contents", async () => {
      await runIntentCommand({ action: "spec-init", workspaceRoot: tmp });
      const result = await runIntentCommand({
        action: "spec-show",
        workspaceRoot: tmp,
      });
      expect(result.success).toBe(true);
      expect(result.lines.join("\n")).toContain("Goal");
    });

    it("returns a failure when SPEC.md does not exist", async () => {
      const result = await runIntentCommand({
        action: "spec-show",
        workspaceRoot: tmp,
      });
      expect(result.success).toBe(false);
      expect(result.error ?? "").toMatch(/not found|SpecNotFound/i);
    });
  });

  describe("decision add", () => {
    it("appends a decision with rationale", async () => {
      await runIntentCommand({ action: "spec-init", workspaceRoot: tmp });
      const result = await runIntentCommand({
        action: "decision-add",
        workspaceRoot: tmp,
        decision: "Ship BYOA",
        rationale: "User owns the key",
      });
      expect(result.success).toBe(true);
      const md = readFileSync(join(tmp, "SPEC.md"), "utf-8");
      expect(md).toContain("Ship BYOA");
      expect(md).toContain("User owns the key");
    });
  });

  describe("byoa status", () => {
    it("prints masked key when ANTHROPIC_API_KEY is set", async () => {
      const secret = "sk-ant-api03-XXXX-DONT-PRINT-wxyz";
      const result = await runIntentCommand({
        action: "byoa-status",
        workspaceRoot: tmp,
        envOverride: {
          envVars: { ANTHROPIC_API_KEY: secret },
          homeDir: tmp,
        },
      });
      expect(result.success).toBe(true);
      const out = result.lines.join("\n");
      expect(out).toContain("sk-ant-…wxyz");
      expect(out).not.toContain(secret);
      expect(out).not.toContain("DONT-PRINT");
    });

    it("reports no BYOA key when none configured", async () => {
      const result = await runIntentCommand({
        action: "byoa-status",
        workspaceRoot: tmp,
        envOverride: {
          envVars: {},
          homeDir: tmp,
        },
      });
      expect(result.success).toBe(true);
      expect(result.lines.join("\n").toLowerCase()).toMatch(/not (detected|set|found)|no byoa/);
    });
  });

  describe("byoa test", () => {
    it("reports success when validator returns 200", async () => {
      const secret = "sk-ant-api03-VALID-test-1234";
      // PROVIDER-AGNOSTIC: model id is mock fixture; the CLI test
      // asserts on validator response handling, not the model.
      const validator: ByoaValidator = async () => ({
        status: 200,
        body: { data: [{ id: getTierModel("balanced").model }] },
      });
      const result = await runIntentCommand({
        action: "byoa-test",
        workspaceRoot: tmp,
        envOverride: {
          envVars: { ANTHROPIC_API_KEY: secret },
          homeDir: tmp,
        },
        validator,
      });
      expect(result.success).toBe(true);
      const out = result.lines.join("\n");
      expect(out).toContain("sk-ant-…1234");
      expect(out).not.toContain("VALID-test");
    });

    it("reports invalid-key without leaking the key", async () => {
      const secret = "sk-ant-api03-BADKEY-never-leak-qwer";
      const validator: ByoaValidator = async () => ({
        status: 401,
        body: { error: { message: "unauthorized" } },
      });
      const result = await runIntentCommand({
        action: "byoa-test",
        workspaceRoot: tmp,
        envOverride: {
          envVars: { ANTHROPIC_API_KEY: secret },
          homeDir: tmp,
        },
        validator,
      });
      expect(result.success).toBe(false);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("BADKEY-never-leak");
      expect(serialized).toContain("sk-ant-…qwer");
    });

    it("reports unreachable when validator network-fails", async () => {
      const secret = "sk-ant-api03-net-fail-asdf";
      const validator: ByoaValidator = async () => {
        throw new Error("ECONNRESET");
      };
      const result = await runIntentCommand({
        action: "byoa-test",
        workspaceRoot: tmp,
        envOverride: {
          envVars: { ANTHROPIC_API_KEY: secret },
          homeDir: tmp,
        },
        validator,
      });
      expect(result.success).toBe(false);
      expect((result.error ?? "").toLowerCase()).toMatch(/unreachable|network/);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secret);
    });

    it("fails cleanly when no BYOA key is configured", async () => {
      const result = await runIntentCommand({
        action: "byoa-test",
        workspaceRoot: tmp,
        envOverride: {
          envVars: {},
          homeDir: tmp,
        },
      });
      expect(result.success).toBe(false);
      expect((result.error ?? "").toLowerCase()).toMatch(/not (detected|set|configured)/);
    });
  });
});
