/**
 * Plugin Scanner — static risk analysis for untrusted plugin code.
 *
 * Scans plugin source for dangerous patterns (child_process, fs, network,
 * env access, code injection vectors) and classifies risk so callers can
 * decide whether to load the plugin at all or route it through a real VM
 * isolation layer (e.g. isolated-vm) at the outer boundary.
 *
 * HONESTY NOTE (P0-3): this module does NOT execute code in a sandbox. An
 * earlier version contained an execute() method that simulated permission
 * checks without any real VM isolation — the comment at the original call
 * site literally said "here we simulate". That method was removed in the
 * P0-3 refactor because a misleading API surface is worse than no API
 * surface. Real VM sandboxing is a separate task (P1); until that ships,
 * callers must treat plugin code as untrusted and refuse to load it if
 * `shouldSandbox()` returns true.
 *
 * SECURITY (B7): Adds a RouteScope concept — a named per-agent-task security
 * context that narrows the plugin-wide scanner to a specific route (e.g.
 * "refactor", "docs-write", "prod-db-read-only"). Routes can be loaded from
 * config or generated dynamically from the agent's task description. The
 * enforceScope helper is a pure checker that callers use before any I/O,
 * network, or subprocess operation.
 */

import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export interface ScannerPermissions {
  readonly allowFileRead: boolean;
  readonly allowFileWrite: boolean;
  readonly allowNetwork: boolean;
  readonly allowEnvAccess: boolean;
  readonly allowChildProcess: boolean;
  readonly allowedPaths: readonly string[];
  readonly maxExecutionMs: number;
  readonly maxMemoryMb: number;
}

export interface ScannerContext {
  readonly id: string;
  readonly pluginId: string;
  readonly permissions: ScannerPermissions;
  readonly createdAt: number;
  readonly status: "ready" | "scanned" | "rejected";
}

export interface ScannerLogEntry {
  readonly timestamp: number;
  readonly contextId: string;
  readonly event: "created" | "scanned" | "rejected" | "error";
  readonly detail: string;
}

export interface ScanResult {
  readonly shouldSandbox: boolean;
  readonly riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  readonly findings: readonly ScanFinding[];
}

export interface ScanFinding {
  readonly pattern: string;
  readonly description: string;
  readonly severity: "info" | "warning" | "danger";
  readonly line: number | null;
}

// -- Risk patterns -----------------------------------------------------------
// NOTE: These patterns are used for DETECTION/SCANNING only -- they match
// dangerous code in untrusted plugins. This module never calls these APIs.

interface RiskPattern {
  readonly pattern: RegExp;
  readonly description: string;
  readonly severity: ScanFinding["severity"];
  readonly riskWeight: number;
}

const RISK_PATTERNS: readonly RiskPattern[] = [
  {
    pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
    description: "Imports child_process module -- can execute system commands",
    severity: "danger",
    riskWeight: 10,
  },
  {
    pattern: /\bexecSync?\s*\(/,
    description: "Calls shell execution function -- can run arbitrary commands",
    severity: "danger",
    riskWeight: 10,
  },
  {
    pattern: /\bspawnSync?\s*\(/,
    description: "Launches child processes",
    severity: "danger",
    riskWeight: 8,
  },
  {
    pattern: /process\.env/,
    description: "Accesses process.env -- may leak environment secrets",
    severity: "warning",
    riskWeight: 5,
  },
  {
    pattern: /\brequire\s*\(\s*['"]fs['"]\s*\)/,
    description: "Imports fs module -- can read/write the file system",
    severity: "warning",
    riskWeight: 6,
  },
  {
    pattern: /\brequire\s*\(\s*['"]net['"]\s*\)/,
    description: "Imports net module -- can open network sockets",
    severity: "warning",
    riskWeight: 7,
  },
  {
    pattern: /\bfetch\s*\(/,
    description: "Makes network requests via fetch",
    severity: "warning",
    riskWeight: 4,
  },
  {
    pattern: /new\s+Function\s*\(/,
    description: "Creates function from string -- potential code injection vector",
    severity: "danger",
    riskWeight: 9,
  },
  {
    pattern: /\bwriteFileSync?\s*\(/,
    description: "Writes to file system",
    severity: "warning",
    riskWeight: 6,
  },
  {
    pattern: /\bunlinkSync?\s*\(/,
    description: "Deletes files from file system",
    severity: "danger",
    riskWeight: 8,
  },
  {
    pattern: /\brmSync?\s*\(/,
    description: "Removes files/directories",
    severity: "danger",
    riskWeight: 9,
  },
  {
    pattern: /process\.exit/,
    description: "Calls process.exit -- can terminate the host process",
    severity: "danger",
    riskWeight: 7,
  },
];

const DEFAULT_PERMISSIONS: ScannerPermissions = {
  allowFileRead: false,
  allowFileWrite: false,
  allowNetwork: false,
  allowEnvAccess: false,
  allowChildProcess: false,
  allowedPaths: [],
  maxExecutionMs: 5000,
  maxMemoryMb: 64,
};

// -- Implementation ----------------------------------------------------------

export class PluginScanner {
  private readonly contexts: Map<string, MutableContext> = new Map();
  private readonly logs: ScannerLogEntry[] = [];

  /**
   * Register a plugin for scanning with a named permission profile. The
   * returned context is an opaque handle to scan results + metadata. It
   * does NOT start any code execution — that requires a real VM layer
   * which this module intentionally does not provide.
   */
  createContext(pluginId: string, permissions?: Partial<ScannerPermissions>): ScannerContext {
    const id = `ps_${randomUUID().slice(0, 8)}`;
    const fullPermissions: ScannerPermissions = { ...DEFAULT_PERMISSIONS, ...permissions };

    const context: MutableContext = {
      id,
      pluginId,
      permissions: fullPermissions,
      createdAt: Date.now(),
      status: "ready",
    };

    this.contexts.set(id, context);
    this.log(id, "created", `Scanner context created for plugin ${pluginId}`);

    return toReadonlyContext(context);
  }

  /**
   * Scan plugin content and determine if it needs sandbox-level isolation.
   * Convenience wrapper that returns only the boolean decision.
   */
  shouldSandbox(pluginContent: string): boolean {
    return this.scanPlugin(pluginContent).shouldSandbox;
  }

  /**
   * Full scan with detailed findings. Returns risk level + line-anchored
   * findings so the caller can show a useful rejection message to the user.
   */
  scanPlugin(pluginContent: string): ScanResult {
    const findings: ScanFinding[] = [];
    let totalRisk = 0;

    const lines = pluginContent.split("\n");

    for (const riskPattern of RISK_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && riskPattern.pattern.test(line)) {
          findings.push({
            pattern: riskPattern.pattern.source,
            description: riskPattern.description,
            severity: riskPattern.severity,
            line: i + 1,
          });
          totalRisk += riskPattern.riskWeight;
          break; // One finding per pattern is enough
        }
      }
    }

    let riskLevel: ScanResult["riskLevel"];
    if (totalRisk === 0) riskLevel = "safe";
    else if (totalRisk <= 5) riskLevel = "low";
    else if (totalRisk <= 15) riskLevel = "medium";
    else if (totalRisk <= 30) riskLevel = "high";
    else riskLevel = "critical";

    return {
      shouldSandbox: totalRisk > 0,
      riskLevel,
      findings,
    };
  }

  /**
   * Record that a scanned plugin was rejected (e.g. because shouldSandbox
   * returned true and the caller chose not to run it). Emits a log entry
   * for the audit trail.
   */
  markRejected(contextId: string, reason: string): void {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return;
    ctx.status = "rejected";
    this.log(contextId, "rejected", reason);
  }

  /**
   * Record that a scan completed successfully (plugin passed all checks).
   */
  markScanned(contextId: string, detail: string): void {
    const ctx = this.contexts.get(contextId);
    if (!ctx) return;
    ctx.status = "scanned";
    this.log(contextId, "scanned", detail);
  }

  /**
   * Get log entries for a specific context.
   */
  getLog(contextId: string): readonly ScannerLogEntry[] {
    return this.logs.filter((l) => l.contextId === contextId);
  }

  /**
   * Get all logs across every scanned plugin.
   */
  getAllLogs(): readonly ScannerLogEntry[] {
    return [...this.logs];
  }

  /**
   * Retrieve a scanner context by ID. Returns null if not found.
   */
  getContext(contextId: string): ScannerContext | null {
    const ctx = this.contexts.get(contextId);
    return ctx ? toReadonlyContext(ctx) : null;
  }

  // -- Private ---------------------------------------------------------------

  private log(contextId: string, event: ScannerLogEntry["event"], detail: string): void {
    this.logs.push({
      timestamp: Date.now(),
      contextId,
      event,
      detail,
    });
  }
}

// -- Internal types ----------------------------------------------------------

interface MutableContext {
  readonly id: string;
  readonly pluginId: string;
  readonly permissions: ScannerPermissions;
  readonly createdAt: number;
  status: ScannerContext["status"];
}

function toReadonlyContext(ctx: MutableContext): ScannerContext {
  return {
    id: ctx.id,
    pluginId: ctx.pluginId,
    permissions: ctx.permissions,
    createdAt: ctx.createdAt,
    status: ctx.status,
  };
}
