import { describe, it, expect, beforeEach } from "vitest";
import {
  ConfirmActionGate,
  type ActionRequest,
  type ActionApproval,
  type ActionCategory,
} from "../../src/security/confirm-action.js";

describe("ConfirmActionGate", () => {
  let gate: ConfirmActionGate;

  beforeEach(() => {
    gate = new ConfirmActionGate();
  });

  // -- classify() -----------------------------------------------------------

  describe("classify", () => {
    it("classifies rm as destructive", () => {
      const result = gate.classify("rm", { path: "/tmp/test" });
      expect(result.category).toBe("destructive");
      expect(result.requiresApproval).toBe(true);
      expect(result.risk).toBe("critical");
    });

    it("classifies delete as destructive", () => {
      const result = gate.classify("delete", { table: "users" });
      expect(result.category).toBe("destructive");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies drop as destructive", () => {
      const result = gate.classify("drop", { database: "production" });
      expect(result.category).toBe("destructive");
    });

    it("classifies force-push as destructive", () => {
      const result = gate.classify("git push --force", { branch: "main" });
      expect(result.category).toBe("destructive");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies reset --hard as destructive", () => {
      const result = gate.classify("reset --hard", { ref: "HEAD~1" });
      expect(result.category).toBe("destructive");
    });

    it("classifies git push as external", () => {
      const result = gate.classify("git push", { remote: "origin" });
      expect(result.category).toBe("external");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies send email as external", () => {
      const result = gate.classify("send email", { to: "user@example.com" });
      expect(result.category).toBe("external");
    });

    it("classifies create PR as external", () => {
      const result = gate.classify("create pull request", { title: "Fix bug" });
      expect(result.category).toBe("external");
    });

    it("classifies purchase as financial", () => {
      const result = gate.classify("purchase", { item: "license" });
      expect(result.category).toBe("financial");
      expect(result.risk).toBe("critical");
    });

    it("classifies billing as financial", () => {
      const result = gate.classify("billing", { action: "update" });
      expect(result.category).toBe("financial");
    });

    it("classifies set token as credential", () => {
      const result = gate.classify("set token", { value: "abc123" });
      expect(result.category).toBe("credential");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies store key as credential", () => {
      const result = gate.classify("store key", { name: "API_KEY" });
      expect(result.category).toBe("credential");
    });

    it("classifies read as safe", () => {
      const result = gate.classify("read", { file: "config.json" });
      expect(result.category).toBe("safe");
      expect(result.requiresApproval).toBe(false);
    });

    it("classifies search as safe", () => {
      const result = gate.classify("search", { query: "function" });
      expect(result.category).toBe("safe");
      expect(result.requiresApproval).toBe(false);
    });

    it("classifies list as safe", () => {
      const result = gate.classify("list", { path: "." });
      expect(result.category).toBe("safe");
    });

    it("classifies status as safe", () => {
      const result = gate.classify("status", {});
      expect(result.category).toBe("safe");
    });

    it("classifies help as safe", () => {
      const result = gate.classify("help", {});
      expect(result.category).toBe("safe");
    });

    it("generates a unique ID for each classification", () => {
      const result1 = gate.classify("read", {});
      const result2 = gate.classify("read", {});
      expect(result1.id).not.toBe(result2.id);
    });

    it("classifies unknown actions without dangerous patterns as safe", () => {
      const result = gate.classify("do-something-benign", { key: "value" });
      expect(result.category).toBe("safe");
      expect(result.requiresApproval).toBe(false);
    });

    it("adds dangerous requests to pending list", () => {
      gate.classify("rm", { path: "/data" });
      const pending = gate.getPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0]?.category).toBe("destructive");
    });

    it("does not add safe requests to pending list", () => {
      gate.classify("read", { file: "test.ts" });
      const pending = gate.getPendingApprovals();
      expect(pending.length).toBe(0);
    });
  });

  // -- isPreApproved() ------------------------------------------------------

  describe("isPreApproved", () => {
    it("pre-approves safe actions", () => {
      const request = gate.classify("read", {});
      expect(gate.isPreApproved(request)).toBe(true);
    });

    it("does not pre-approve destructive actions by default", () => {
      const request = gate.classify("rm", { path: "/data" });
      expect(gate.isPreApproved(request)).toBe(false);
    });

    it("does not pre-approve financial actions by default", () => {
      const request = gate.classify("purchase", { item: "plan" });
      expect(gate.isPreApproved(request)).toBe(false);
    });

    it("pre-approves when a matching pattern is added", () => {
      gate.addPreApprovalPattern(/^deploy$/);
      const request = gate.classify("deploy", { target: "staging" });
      // deploy matches external, normally requires approval
      expect(gate.isPreApproved(request)).toBe(true);
    });
  });

  // -- recordApproval() -----------------------------------------------------

  describe("recordApproval", () => {
    it("records an approval and removes from pending", () => {
      const request = gate.classify("rm", { path: "/data" });

      gate.recordApproval({
        requestId: request.id,
        approved: true,
        approvedBy: "user",
        approvedAt: Date.now(),
        reason: "Intentional cleanup",
      });

      expect(gate.getPendingApprovals().length).toBe(0);
    });

    it("records a denial", () => {
      const request = gate.classify("delete", { table: "production" });

      gate.recordApproval({
        requestId: request.id,
        approved: false,
        approvedBy: "user",
        approvedAt: Date.now(),
        reason: "Too risky",
      });

      expect(gate.getPendingApprovals().length).toBe(0);
      const history = gate.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.approved).toBe(false);
    });
  });

  // -- getHistory() ---------------------------------------------------------

  describe("getHistory", () => {
    it("returns empty history initially", () => {
      expect(gate.getHistory()).toEqual([]);
    });

    it("returns history sorted newest first", () => {
      const req1 = gate.classify("rm", { path: "/a" });
      const req2 = gate.classify("delete", { table: "b" });

      gate.recordApproval({
        requestId: req1.id,
        approved: true,
        approvedBy: "user",
        approvedAt: 1000,
      });
      gate.recordApproval({
        requestId: req2.id,
        approved: false,
        approvedBy: "user",
        approvedAt: 2000,
      });

      const history = gate.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]?.approvedAt).toBe(2000);
      expect(history[1]?.approvedAt).toBe(1000);
    });

    it("respects the limit parameter", () => {
      const req1 = gate.classify("rm", { path: "/a" });
      const req2 = gate.classify("delete", { table: "b" });
      const req3 = gate.classify("drop", { db: "c" });

      gate.recordApproval({ requestId: req1.id, approved: true, approvedBy: "user", approvedAt: 100 });
      gate.recordApproval({ requestId: req2.id, approved: true, approvedBy: "user", approvedAt: 200 });
      gate.recordApproval({ requestId: req3.id, approved: true, approvedBy: "user", approvedAt: 300 });

      const history = gate.getHistory(2);
      expect(history.length).toBe(2);
    });
  });

  // -- getStats() -----------------------------------------------------------

  describe("getStats", () => {
    it("returns zero stats initially", () => {
      const stats = gate.getStats();
      expect(stats.pendingCount).toBe(0);
      expect(stats.approvedCount).toBe(0);
      expect(stats.deniedCount).toBe(0);
      expect(stats.totalClassified).toBe(0);
    });

    it("tracks pending, approved, and denied counts", () => {
      const req1 = gate.classify("rm", { path: "/a" });
      const req2 = gate.classify("delete", { table: "b" });
      gate.classify("drop", { db: "c" }); // stays pending

      gate.recordApproval({ requestId: req1.id, approved: true, approvedBy: "user", approvedAt: 100 });
      gate.recordApproval({ requestId: req2.id, approved: false, approvedBy: "user", approvedAt: 200 });

      const stats = gate.getStats();
      expect(stats.pendingCount).toBe(1);
      expect(stats.approvedCount).toBe(1);
      expect(stats.deniedCount).toBe(1);
      expect(stats.totalClassified).toBe(3);
    });
  });
});
