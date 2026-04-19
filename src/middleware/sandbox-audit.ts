/**
 * SandboxAuditMiddleware — structured audit trail for sandbox exec and
 * file operations.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/agents/middlewares/sandbox_audit_middleware.py
 *
 * Intercepts sandbox-scoped tool calls (bash, write, str_replace) BEFORE
 * execution and records a structured audit entry per attempt. Unlike a
 * general telemetry stream, these entries are scoped to the per-request
 * audit buffer so callers can flush them to `telemetry/audit-trail.ts`
 * or a security log after the turn completes.
 *
 * Classification buckets:
 *   - pass  — matches no risk pattern; executed normally.
 *   - warn  — medium-risk (chmod 777, pip install, sudo); executed,
 *             warning note appended to follow-up.
 *   - block — high-risk (rm -rf /, curl | bash, dynamic linker); NOT
 *             executed; a synthetic `tool` error is injected so the
 *             agent can see the denial and adapt.
 *
 * Honest stub: this middleware does NOT execute the sandbox itself —
 * it only classifies and audits. The actual execution layer is the
 * existing `sandboxMiddleware` in `layers.ts`.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { AgentMessage } from "../core/types.js";

// -- Risk classification --------------------------------------------------

const HIGH_RISK_PATTERNS: readonly RegExp[] = [
  /rm\s+-[^\s]*r[^\s]*\s+(\/\*?|~\/?\*?|\/home\b|\/root\b)\s*$/,
  /dd\s+if=/,
  /mkfs/,
  /cat\s+\/etc\/shadow/,
  />+\s*\/etc\//,
  /\|\s*(ba)?sh\b/,
  /[`$]\(?\s*(curl|wget|bash|sh|python|ruby|perl|base64)/,
  /base64\s+.*-d.*\|/,
  />+\s*(\/usr\/bin\/|\/bin\/|\/sbin\/)/,
  />+\s*~\/?\.(bashrc|profile|zshrc|bash_profile)/,
  /\/proc\/[^/]+\/environ/,
  /\b(LD_PRELOAD|LD_LIBRARY_PATH)\s*=/,
  /\/dev\/tcp\//,
  /:\(\)\s*\{[^}]*\|\s*:\s*&/,
  /while\s+true.*&\s*done/,
];

const MEDIUM_RISK_PATTERNS: readonly RegExp[] = [
  /chmod\s+777/,
  /pip3?\s+install/,
  /apt(-get)?\s+install/,
  /\b(sudo|su)\b/,
  /\bPATH\s*=/,
];

export type AuditVerdict = "pass" | "warn" | "block";

export function classifyCommand(command: string): AuditVerdict {
  if (command.length === 0) return "block";
  const normalized = command.split(/\s+/).join(" ");
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(normalized)) return "block";
  }
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(normalized)) return "warn";
  }
  return "pass";
}

// -- Audit entry shape ----------------------------------------------------

export interface SandboxAuditEntry {
  readonly timestamp: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly command: string;
  readonly verdict: AuditVerdict;
  readonly rejectionReason?: string;
}

export interface SandboxAuditStats {
  readonly totalAudits: number;
  readonly blocked: number;
  readonly warned: number;
  readonly passed: number;
}

// -- Context extension ---------------------------------------------------

declare module "./types.js" {
  interface MiddlewareContext {
    sandboxAuditEntries?: readonly SandboxAuditEntry[];
  }
}

// -- Middleware class -----------------------------------------------------

const SANDBOX_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "bash",
  "Shell",
  "Write",
  "write_file",
  "str_replace",
  "Edit",
]);

const COMMAND_LOG_LIMIT = 200;
const MAX_COMMAND_LENGTH = 10_000;

function extractCommand(msg: AgentMessage): string {
  // WOTANN's AgentMessage carries args in `content` as string. Best-effort:
  // if content is a JSON string with a `command` / `file_path` field, extract.
  if (!msg.content) return "";
  try {
    const parsed = JSON.parse(msg.content) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const cmd = obj["command"] ?? obj["file_path"] ?? obj["path"];
      if (typeof cmd === "string") return cmd;
    }
  } catch {
    // Not JSON — treat content itself as the command payload.
  }
  return msg.content;
}

function validateCommand(command: string): string | null {
  if (command.trim().length === 0) return "empty command";
  if (command.length > MAX_COMMAND_LENGTH) return "command too long";
  if (command.includes("\x00")) return "null byte detected";
  return null;
}

/**
 * SandboxAuditMiddleware scans tool-use messages targeting sandbox-scoped
 * tools, classifies them, and emits an audit entry per call. High-risk
 * calls get a synthetic denial `tool` message injected into history.
 */
export class SandboxAuditMiddleware {
  private totalAudits = 0;
  private blocked = 0;
  private warned = 0;
  private passed = 0;

  /**
   * Classify a single tool-use message and produce an audit entry. Does
   * not mutate the message.
   */
  audit(sessionId: string, msg: AgentMessage): SandboxAuditEntry {
    this.totalAudits++;
    const command = extractCommand(msg);
    const rejection = validateCommand(command);

    const verdict: AuditVerdict = rejection !== null ? "block" : classifyCommand(command);

    if (verdict === "block") this.blocked++;
    else if (verdict === "warn") this.warned++;
    else this.passed++;

    const loggedCommand =
      command.length > COMMAND_LOG_LIMIT
        ? `${command.slice(0, COMMAND_LOG_LIMIT)}... (${command.length} chars)`
        : command;

    const entry: SandboxAuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId,
      toolName: msg.toolName ?? "unknown",
      toolCallId: msg.toolCallId ?? "missing_id",
      command: loggedCommand,
      verdict,
    };
    return rejection !== null ? { ...entry, rejectionReason: rejection } : entry;
  }

  /**
   * Build a synthetic tool message reflecting a block decision so the
   * agent sees the denial on its next turn.
   */
  buildBlockMessage(entry: SandboxAuditEntry): AgentMessage {
    const reason = entry.rejectionReason ?? "security violation detected";
    return {
      role: "tool",
      content: `[SandboxAudit] Command blocked: ${reason}. Please choose a safer approach.`,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
    };
  }

  getStats(): SandboxAuditStats {
    return {
      totalAudits: this.totalAudits,
      blocked: this.blocked,
      warned: this.warned,
      passed: this.passed,
    };
  }

  reset(): void {
    this.totalAudits = 0;
    this.blocked = 0;
    this.warned = 0;
    this.passed = 0;
  }
}

// -- Pipeline adapter -----------------------------------------------------

export function createSandboxAuditMiddleware(instance: SandboxAuditMiddleware): Middleware {
  return {
    name: "SandboxAudit",
    order: 4.7,
    before(ctx: MiddlewareContext): MiddlewareContext {
      const history = ctx.recentHistory;
      if (history.length === 0) return ctx;

      const existingResults = new Set<string>();
      for (const msg of history) {
        if (msg.role === "tool" && msg.toolCallId) {
          existingResults.add(msg.toolCallId);
        }
      }

      const newEntries: SandboxAuditEntry[] = [];
      const blockInjections: AgentMessage[] = [];

      for (const msg of history) {
        if (
          msg.role !== "assistant" ||
          !msg.toolCallId ||
          !msg.toolName ||
          !SANDBOX_TOOLS.has(msg.toolName) ||
          existingResults.has(msg.toolCallId)
        ) {
          continue;
        }
        const entry = instance.audit(ctx.sessionId, msg);
        newEntries.push(entry);
        if (entry.verdict === "block") {
          blockInjections.push(instance.buildBlockMessage(entry));
        }
      }

      if (newEntries.length === 0) return ctx;

      const existingEntries = ctx.sandboxAuditEntries ?? [];
      const mergedEntries: readonly SandboxAuditEntry[] = [...existingEntries, ...newEntries];
      const nextHistory: readonly AgentMessage[] =
        blockInjections.length > 0 ? [...history, ...blockInjections] : history;

      return {
        ...ctx,
        recentHistory: nextHistory,
        sandboxAuditEntries: mergedEntries,
      };
    },
  };
}
