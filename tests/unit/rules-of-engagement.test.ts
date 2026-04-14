import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RulesOfEngagement,
  type ROEScope,
  type ROESession,
  type ROEAuditEntry,
} from "../../src/security/rules-of-engagement.js";

describe("Rules of Engagement", () => {
  let roe: RulesOfEngagement;

  beforeEach(() => {
    roe = new RulesOfEngagement();
  });

  // ── Session Creation ────────────────────────────────

  describe("session creation", () => {
    it("creates a session with correct type and scope", () => {
      const scope: ROEScope = {
        domains: ["example.com"],
        ipRanges: ["192.168.1.0/24"],
        pathPatterns: [],
        excludedTargets: [],
      };

      const session = roe.startSession("pentest", scope);

      expect(session.id).toBeDefined();
      expect(session.sessionType).toBe("pentest");
      expect(session.scope).toEqual(scope);
      expect(session.auditEntries).toEqual([]);
      expect(session.termsAcceptedAt).toBe(0);
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("supports all session types", () => {
      const scope: ROEScope = {
        domains: ["test.local"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      };

      const types = ["security-research", "ethical-hacking", "ctf", "pentest"] as const;
      for (const type of types) {
        const session = roe.startSession(type, scope);
        expect(session.sessionType).toBe(type);
      }
    });

    it("uses custom timeout when provided", () => {
      const scope: ROEScope = {
        domains: ["test.local"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      };

      const oneHour = 60 * 60 * 1000;
      const before = Date.now();
      const session = roe.startSession("ctf", scope, oneHour);

      expect(session.expiresAt).toBeGreaterThanOrEqual(before + oneHour);
      expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + oneHour);
    });

    it("creates sessions with unique IDs", () => {
      const scope: ROEScope = {
        domains: ["test.local"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      };

      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        ids.add(roe.startSession("ctf", scope).id);
      }
      expect(ids.size).toBe(10);
    });
  });

  // ── Terms Acceptance ────────────────────────────────

  describe("terms acceptance", () => {
    it("accepts terms for a valid session", () => {
      const session = roe.startSession("pentest", {
        domains: ["example.com"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });

      expect(roe.hasAcceptedTerms(session.id)).toBe(false);
      const result = roe.acceptTerms(session.id);
      expect(result).toBe(true);
      expect(roe.hasAcceptedTerms(session.id)).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(roe.acceptTerms("non-existent-id")).toBe(false);
    });

    it("returns false for expired session", () => {
      const session = roe.startSession(
        "ctf",
        { domains: ["test.local"], ipRanges: [], pathPatterns: [], excludedTargets: [] },
        1, // 1ms timeout — will expire immediately
      );

      // Wait for expiry
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);
      const result = roe.acceptTerms(session.id);
      expect(result).toBe(false);
      vi.useRealTimers();
    });

    it("sets termsAcceptedAt timestamp on acceptance", () => {
      const session = roe.startSession("security-research", {
        domains: ["target.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });

      const before = Date.now();
      roe.acceptTerms(session.id);
      const updated = roe.getSession(session.id);

      expect(updated?.termsAcceptedAt).toBeGreaterThanOrEqual(before);
      expect(updated?.termsAcceptedAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns terms with version and required acknowledgements", () => {
      const terms = roe.getTerms();
      expect(terms.version).toBeDefined();
      expect(terms.text.length).toBeGreaterThan(0);
      expect(terms.requiredAcknowledgements.length).toBeGreaterThan(0);
      expect(terms.text).toContain("authorized");
    });
  });

  // ── Scope Restriction ─────────────────────────────

  describe("scope restriction", () => {
    it("allows targets matching domain scope", () => {
      const session = roe.startSession("pentest", {
        domains: ["example.com"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });

      expect(roe.isInScope(session.id, "example.com")).toBe(true);
      expect(roe.isInScope(session.id, "sub.example.com")).toBe(true);
      expect(roe.isInScope(session.id, "evil.com")).toBe(false);
    });

    it("allows targets matching IP range scope", () => {
      const session = roe.startSession("pentest", {
        domains: [],
        ipRanges: ["192.168.1.0/24"],
        pathPatterns: [],
        excludedTargets: [],
      });

      expect(roe.isInScope(session.id, "192.168.1.1")).toBe(true);
      expect(roe.isInScope(session.id, "192.168.1.254")).toBe(true);
      expect(roe.isInScope(session.id, "192.168.2.1")).toBe(false);
      expect(roe.isInScope(session.id, "10.0.0.1")).toBe(false);
    });

    it("allows targets matching exact IP", () => {
      const session = roe.startSession("pentest", {
        domains: [],
        ipRanges: ["10.0.0.5"],
        pathPatterns: [],
        excludedTargets: [],
      });

      expect(roe.isInScope(session.id, "10.0.0.5")).toBe(true);
      expect(roe.isInScope(session.id, "10.0.0.6")).toBe(false);
    });

    it("allows targets matching path patterns", () => {
      const session = roe.startSession("ctf", {
        domains: [],
        ipRanges: [],
        pathPatterns: ["/api/**", "/admin/*"],
        excludedTargets: [],
      });

      expect(roe.isInScope(session.id, "/api/users")).toBe(true);
      expect(roe.isInScope(session.id, "/api/v2/deep/path")).toBe(true);
      expect(roe.isInScope(session.id, "/admin/login")).toBe(true);
      expect(roe.isInScope(session.id, "/public/page")).toBe(false);
    });

    it("respects excluded targets", () => {
      const session = roe.startSession("pentest", {
        domains: ["example.com"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: ["prod.example.com"],
      });

      expect(roe.isInScope(session.id, "dev.example.com")).toBe(true);
      expect(roe.isInScope(session.id, "prod.example.com")).toBe(false);
    });

    it("returns false for non-existent session", () => {
      expect(roe.isInScope("fake-id", "example.com")).toBe(false);
    });
  });

  // ── Audit Trail ───────────────────────────────────

  describe("audit trail", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = roe.startSession("pentest", {
        domains: ["target.test"],
        ipRanges: ["10.0.0.0/8"],
        pathPatterns: [],
        excludedTargets: [],
      });
      sessionId = session.id;
      roe.acceptTerms(sessionId);
    });

    it("records actions in the audit trail", () => {
      roe.recordAction(sessionId, "port-scan", "target.test");
      roe.recordAction(sessionId, "vuln-scan", "target.test");

      const trail = roe.getAuditTrail(sessionId);
      expect(trail).toHaveLength(2);
      expect(trail[0]!.action).toBe("port-scan");
      expect(trail[1]!.action).toBe("vuln-scan");
    });

    it("includes target in audit entries", () => {
      roe.recordAction(sessionId, "nmap-scan", "10.0.0.1");
      const trail = roe.getAuditTrail(sessionId);
      expect(trail[0]!.target).toBe("10.0.0.1");
    });

    it("includes timestamps in audit entries", () => {
      const before = Date.now();
      roe.recordAction(sessionId, "test-action", "target.test");
      const trail = roe.getAuditTrail(sessionId);

      expect(trail[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(trail[0]!.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("throws when recording without terms accepted", () => {
      const newSession = roe.startSession("ctf", {
        domains: ["ctf.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });

      expect(() => {
        roe.recordAction(newSession.id, "test", "ctf.test");
      }).toThrow("Terms not accepted");
    });

    it("throws when recording to non-existent session", () => {
      expect(() => {
        roe.recordAction("fake-id", "test", "target.test");
      }).toThrow("Session not found");
    });

    it("throws when target is out of scope", () => {
      expect(() => {
        roe.recordAction(sessionId, "attack", "evil.com");
      }).toThrow("Target not in scope");
    });

    it("returns empty array for non-existent session", () => {
      expect(roe.getAuditTrail("fake-id")).toEqual([]);
    });
  });

  // ── Hash Chain Integrity ──────────────────────────

  describe("audit trail integrity (hash chain)", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = roe.startSession("security-research", {
        domains: ["target.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });
      sessionId = session.id;
      roe.acceptTerms(sessionId);
    });

    it("maintains valid hash chain across entries", () => {
      roe.recordAction(sessionId, "recon", "target.test");
      roe.recordAction(sessionId, "scan", "target.test");
      roe.recordAction(sessionId, "exploit", "target.test");

      expect(roe.verifyAuditIntegrity(sessionId)).toBe(true);
    });

    it("first entry has genesis as previous hash", () => {
      roe.recordAction(sessionId, "first-action", "target.test");
      const trail = roe.getAuditTrail(sessionId);

      expect(trail[0]!.previousHash).toBe("genesis");
    });

    it("each entry references the previous entry hash", () => {
      roe.recordAction(sessionId, "action-1", "target.test");
      roe.recordAction(sessionId, "action-2", "target.test");
      roe.recordAction(sessionId, "action-3", "target.test");

      const trail = roe.getAuditTrail(sessionId);
      expect(trail[1]!.previousHash).toBe(trail[0]!.hash);
      expect(trail[2]!.previousHash).toBe(trail[1]!.hash);
    });

    it("each entry has a unique hash", () => {
      roe.recordAction(sessionId, "action-1", "target.test");
      roe.recordAction(sessionId, "action-2", "target.test");

      const trail = roe.getAuditTrail(sessionId);
      expect(trail[0]!.hash).not.toBe(trail[1]!.hash);
    });

    it("hashes are valid SHA-256 hex strings", () => {
      roe.recordAction(sessionId, "test", "target.test");
      const trail = roe.getAuditTrail(sessionId);

      expect(trail[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns false for non-existent session integrity check", () => {
      expect(roe.verifyAuditIntegrity("fake-id")).toBe(false);
    });

    it("verifies integrity of empty audit trail", () => {
      expect(roe.verifyAuditIntegrity(sessionId)).toBe(true);
    });
  });

  // ── Session Expiry ────────────────────────────────

  describe("session expiry", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("session is not expired within timeout", () => {
      const session = roe.startSession(
        "ctf",
        { domains: ["ctf.test"], ipRanges: [], pathPatterns: [], excludedTargets: [] },
        60_000,
      );

      expect(roe.isSessionExpired(session.id)).toBe(false);
    });

    it("session expires after timeout", () => {
      vi.useFakeTimers();
      const session = roe.startSession(
        "pentest",
        { domains: ["test.local"], ipRanges: [], pathPatterns: [], excludedTargets: [] },
        1000,
      );

      expect(roe.isSessionExpired(session.id)).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(roe.isSessionExpired(session.id)).toBe(true);
    });

    it("throws when recording action on expired session", () => {
      vi.useFakeTimers();
      const session = roe.startSession(
        "pentest",
        { domains: ["target.test"], ipRanges: [], pathPatterns: [], excludedTargets: [] },
        100,
      );
      roe.acceptTerms(session.id);

      vi.advanceTimersByTime(200);

      expect(() => {
        roe.recordAction(session.id, "test", "target.test");
      }).toThrow("Session expired");
    });

    it("returns true for non-existent session expiry check", () => {
      expect(roe.isSessionExpired("non-existent")).toBe(true);
    });
  });

  // ── Export Format ─────────────────────────────────

  describe("audit report export", () => {
    it("exports valid JSON with all required fields", () => {
      const session = roe.startSession("ethical-hacking", {
        domains: ["target.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });
      roe.acceptTerms(session.id);
      roe.recordAction(session.id, "recon", "target.test");

      const report = roe.exportAuditReport(session.id);
      const parsed = JSON.parse(report);

      expect(parsed.sessionId).toBe(session.id);
      expect(parsed.sessionType).toBe("ethical-hacking");
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.expiresAt).toBeDefined();
      expect(parsed.termsAcceptedAt).toBeGreaterThan(0);
      expect(parsed.scope).toBeDefined();
      expect(parsed.generatedAt).toBeDefined();
      expect(parsed.entryCount).toBe(1);
      expect(parsed.integrityValid).toBe(true);
      expect(parsed.entries).toHaveLength(1);
    });

    it("includes scope in export", () => {
      const scope: ROEScope = {
        domains: ["example.com"],
        ipRanges: ["10.0.0.0/8"],
        pathPatterns: ["/api/**"],
        excludedTargets: ["prod.example.com"],
      };
      const session = roe.startSession("pentest", scope);

      const report = roe.exportAuditReport(session.id);
      const parsed = JSON.parse(report);

      expect(parsed.scope.domains).toEqual(["example.com"]);
      expect(parsed.scope.ipRanges).toEqual(["10.0.0.0/8"]);
      expect(parsed.scope.pathPatterns).toEqual(["/api/**"]);
      expect(parsed.scope.excludedTargets).toEqual(["prod.example.com"]);
    });

    it("reports integrity status accurately", () => {
      const session = roe.startSession("ctf", {
        domains: ["ctf.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });
      roe.acceptTerms(session.id);
      roe.recordAction(session.id, "action-1", "ctf.test");
      roe.recordAction(session.id, "action-2", "ctf.test");

      const report = roe.exportAuditReport(session.id);
      const parsed = JSON.parse(report);

      expect(parsed.integrityValid).toBe(true);
    });

    it("returns error JSON for non-existent session", () => {
      const report = roe.exportAuditReport("fake-id");
      const parsed = JSON.parse(report);

      expect(parsed.error).toBe("Session not found");
      expect(parsed.sessionId).toBe("fake-id");
    });

    it("export is pretty-printed JSON", () => {
      const session = roe.startSession("security-research", {
        domains: ["test.local"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });

      const report = roe.exportAuditReport(session.id);
      // Pretty-printed JSON has newlines and indentation
      expect(report).toContain("\n");
      expect(report).toContain("  ");
    });

    it("multiple entries maintain correct order in export", () => {
      const session = roe.startSession("pentest", {
        domains: ["target.test"],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });
      roe.acceptTerms(session.id);
      roe.recordAction(session.id, "step-1", "target.test");
      roe.recordAction(session.id, "step-2", "target.test");
      roe.recordAction(session.id, "step-3", "target.test");

      const report = roe.exportAuditReport(session.id);
      const parsed = JSON.parse(report);

      expect(parsed.entries[0].action).toBe("step-1");
      expect(parsed.entries[1].action).toBe("step-2");
      expect(parsed.entries[2].action).toBe("step-3");
      expect(parsed.entryCount).toBe(3);
    });
  });
});
