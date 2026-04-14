/**
 * Rules of Engagement (ROE) Framework — structured security research sessions
 * with terms acceptance, scope restriction, audit logging, and auto-expiry.
 *
 * DESIGN:
 * - Immutable session records (new objects on every mutation)
 * - Append-only audit log with SHA-256 hash-chain integrity
 * - Scope restriction by domain, IP, CIDR, and path pattern
 * - Configurable session timeout with auto-expiry
 * - No external dependencies (uses node:crypto only)
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

// ── Types ───────────────────────────────────────────────

export type ROESessionType =
  | "security-research"
  | "ethical-hacking"
  | "ctf"
  | "pentest";

export interface ROEScope {
  readonly domains: readonly string[];
  readonly ipRanges: readonly string[];
  readonly pathPatterns: readonly string[];
  readonly excludedTargets: readonly string[];
}

export interface ROEAuditEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly action: string;
  readonly target: string;
  readonly previousHash: string;
  readonly hash: string;
}

export interface ROESession {
  readonly id: string;
  readonly sessionType: ROESessionType;
  readonly termsAcceptedAt: number;
  readonly scope: ROEScope;
  readonly auditEntries: readonly ROEAuditEntry[];
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface ROETerms {
  readonly version: string;
  readonly text: string;
  readonly requiredAcknowledgements: readonly string[];
}

// ── Constants ───────────────────────────────────────────

const DEFAULT_SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const GENESIS_HASH = "genesis";

const DEFAULT_TERMS: ROETerms = {
  version: "1.0.0",
  text: [
    "RULES OF ENGAGEMENT — SECURITY RESEARCH SESSION",
    "",
    "By accepting these terms, you acknowledge that:",
    "1. You are conducting authorized security testing",
    "2. You have written permission to test the target systems",
    "3. Your testing is limited to the defined scope",
    "4. All actions will be logged in a tamper-evident audit trail",
    "5. You will follow responsible disclosure practices",
    "6. You comply with applicable laws and regulations",
    "7. You accept personal responsibility for all actions taken",
    "8. Session data may be retained for compliance purposes",
  ].join("\n"),
  requiredAcknowledgements: [
    "authorized-testing",
    "scope-limited",
    "actions-logged",
    "responsible-disclosure",
    "legal-compliance",
  ],
};

// ── Hash Chain Utilities ────────────────────────────────

function computeEntryHash(
  id: string,
  timestamp: number,
  action: string,
  target: string,
  previousHash: string,
): string {
  const input = `${id}:${timestamp}:${action}:${target}:${previousHash}`;
  return createHash("sha256").update(input).digest("hex");
}

function verifyHashChain(entries: readonly ROEAuditEntry[]): boolean {
  let prevHash = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.previousHash !== prevHash) return false;
    const expected = computeEntryHash(
      entry.id,
      entry.timestamp,
      entry.action,
      entry.target,
      prevHash,
    );
    if (entry.hash !== expected) return false;
    prevHash = entry.hash;
  }
  return true;
}

// ── Scope Matching ──────────────────────────────────────

function matchesDomain(target: string, domain: string): boolean {
  const normalized = target.toLowerCase();
  const domainLower = domain.toLowerCase();
  // Exact match or subdomain match
  return normalized === domainLower || normalized.endsWith(`.${domainLower}`);
}

function matchesIpRange(target: string, range: string): boolean {
  // Simple CIDR or exact IP match
  if (!range.includes("/")) {
    return target === range;
  }
  const [rangeIp, prefixStr] = range.split("/");
  if (!rangeIp || !prefixStr) return false;
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const targetParts = target.split(".").map(Number);
  const rangeParts = rangeIp.split(".").map(Number);
  if (targetParts.length !== 4 || rangeParts.length !== 4) return false;
  if (targetParts.some((p) => isNaN(p ?? NaN)) || rangeParts.some((p) => isNaN(p ?? NaN))) return false;

  const targetNum =
    ((targetParts[0] ?? 0) << 24) |
    ((targetParts[1] ?? 0) << 16) |
    ((targetParts[2] ?? 0) << 8) |
    (targetParts[3] ?? 0);
  const rangeNum =
    ((rangeParts[0] ?? 0) << 24) |
    ((rangeParts[1] ?? 0) << 16) |
    ((rangeParts[2] ?? 0) << 8) |
    (rangeParts[3] ?? 0);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return ((targetNum >>> 0) & mask) === ((rangeNum >>> 0) & mask);
}

function matchesPathPattern(target: string, pattern: string): boolean {
  // Simple glob-to-regex: * matches any segment, ** matches any path
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "DOUBLE_STAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DOUBLE_STAR/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(target);
}

function isTargetInScope(target: string, scope: ROEScope): boolean {
  // Check exclusions first
  for (const excluded of scope.excludedTargets) {
    if (target.includes(excluded)) return false;
  }

  // Check domains
  for (const domain of scope.domains) {
    if (matchesDomain(target, domain)) return true;
  }

  // Check IP ranges
  for (const range of scope.ipRanges) {
    if (matchesIpRange(target, range)) return true;
  }

  // Check path patterns
  for (const pattern of scope.pathPatterns) {
    if (matchesPathPattern(target, pattern)) return true;
  }

  // If scope is completely empty, nothing is in scope
  return scope.domains.length === 0 &&
    scope.ipRanges.length === 0 &&
    scope.pathPatterns.length === 0;
}

// ── RulesOfEngagement Class ─────────────────────────────

export class RulesOfEngagement {
  private readonly sessions: Map<string, ROESession> = new Map();
  private readonly termsAccepted: Set<string> = new Set();

  /**
   * Get the terms that must be accepted before starting a session.
   */
  getTerms(): ROETerms {
    return DEFAULT_TERMS;
  }

  /**
   * Start a new security research session.
   * Terms must be accepted before any actions can be recorded.
   */
  startSession(
    type: ROESessionType,
    scope: ROEScope,
    timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
  ): ROESession {
    const now = Date.now();
    const session: ROESession = {
      id: randomUUID(),
      sessionType: type,
      termsAcceptedAt: 0,
      scope,
      auditEntries: [],
      expiresAt: now + timeoutMs,
      createdAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Accept terms for a session. Returns true if acceptance was recorded,
   * false if the session doesn't exist or has expired.
   */
  acceptTerms(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (this.isExpired(session)) return false;

    const updated: ROESession = {
      ...session,
      termsAcceptedAt: Date.now(),
    };
    this.sessions.set(sessionId, updated);
    this.termsAccepted.add(sessionId);
    return true;
  }

  /**
   * Check if terms have been accepted for a session.
   */
  hasAcceptedTerms(sessionId: string): boolean {
    return this.termsAccepted.has(sessionId);
  }

  /**
   * Record an action in the session's audit trail.
   * Requires terms to be accepted and target to be in scope.
   * Throws if preconditions are not met.
   */
  recordAction(sessionId: string, action: string, target: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.isExpired(session)) {
      throw new Error(`Session expired: ${sessionId}`);
    }
    if (!this.termsAccepted.has(sessionId)) {
      throw new Error(`Terms not accepted for session: ${sessionId}`);
    }
    if (!isTargetInScope(target, session.scope)) {
      throw new Error(`Target not in scope: ${target}`);
    }

    const previousHash = session.auditEntries.length > 0
      ? session.auditEntries[session.auditEntries.length - 1]!.hash
      : GENESIS_HASH;

    const id = randomUUID();
    const timestamp = Date.now();
    const hash = computeEntryHash(id, timestamp, action, target, previousHash);

    const entry: ROEAuditEntry = {
      id,
      timestamp,
      action,
      target,
      previousHash,
      hash,
    };

    const updated: ROESession = {
      ...session,
      auditEntries: [...session.auditEntries, entry],
    };
    this.sessions.set(sessionId, updated);
  }

  /**
   * Check if a target is within the session's defined scope.
   */
  isInScope(sessionId: string, target: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return isTargetInScope(target, session.scope);
  }

  /**
   * Get the full audit trail for a session.
   */
  getAuditTrail(sessionId: string): readonly ROEAuditEntry[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.auditEntries;
  }

  /**
   * Verify the hash-chain integrity of a session's audit trail.
   */
  verifyAuditIntegrity(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return verifyHashChain(session.auditEntries);
  }

  /**
   * Get the current session object.
   */
  getSession(sessionId: string): ROESession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session has expired.
   */
  isSessionExpired(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return true;
    return this.isExpired(session);
  }

  /**
   * Export the audit trail as a JSON compliance report.
   */
  exportAuditReport(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return JSON.stringify({
        error: "Session not found",
        sessionId,
        generatedAt: Date.now(),
      }, null, 2);
    }

    return JSON.stringify({
      sessionId: session.id,
      sessionType: session.sessionType,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      termsAcceptedAt: session.termsAcceptedAt,
      scope: session.scope,
      generatedAt: Date.now(),
      entryCount: session.auditEntries.length,
      integrityValid: verifyHashChain(session.auditEntries),
      entries: session.auditEntries,
    }, null, 2);
  }

  private isExpired(session: ROESession): boolean {
    return Date.now() > session.expiresAt;
  }
}
