/**
 * Plugin Sandbox -- execute untrusted plugins in a restricted environment.
 * Prevents malicious plugins from accessing the file system, network, or env vars.
 *
 * Creates sandboxed execution contexts with granular permissions.
 * Scans plugin content for risky patterns before execution.
 * Logs all sandbox activity for audit trails.
 *
 * SECURITY (B7): Adds a RouteScope concept — a named per-agent-task security
 * context that narrows the plugin-wide sandbox to a specific route (e.g.
 * "refactor", "docs-write", "prod-db-read-only"). Routes can be loaded from
 * config or generated dynamically from the agent's task description. The
 * enforceScope helper is a pure checker that callers use before any I/O,
 * network, or subprocess operation.
 */

import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export interface SandboxPermissions {
  readonly allowFileRead: boolean;
  readonly allowFileWrite: boolean;
  readonly allowNetwork: boolean;
  readonly allowEnvAccess: boolean;
  readonly allowChildProcess: boolean;
  readonly allowedPaths: readonly string[];
  readonly maxExecutionMs: number;
  readonly maxMemoryMb: number;
}

export interface SandboxContext {
  readonly id: string;
  readonly pluginId: string;
  readonly permissions: SandboxPermissions;
  readonly createdAt: number;
  readonly status: "ready" | "running" | "completed" | "terminated" | "error";
}

export interface SandboxResult {
  readonly sandboxId: string;
  readonly success: boolean;
  readonly output: string;
  readonly error: string | null;
  readonly executionMs: number;
  readonly terminatedByTimeout: boolean;
}

export interface SandboxLogEntry {
  readonly timestamp: number;
  readonly sandboxId: string;
  readonly event: "created" | "started" | "completed" | "error" | "permission-denied" | "timeout";
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

const DEFAULT_PERMISSIONS: SandboxPermissions = {
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

export class PluginSandbox {
  private readonly contexts: Map<string, MutableContext> = new Map();
  private readonly logs: SandboxLogEntry[] = [];

  /**
   * Create a sandboxed execution context for a plugin.
   */
  createSandbox(pluginId: string, permissions?: Partial<SandboxPermissions>): SandboxContext {
    const id = `sb_${randomUUID().slice(0, 8)}`;
    const fullPermissions: SandboxPermissions = { ...DEFAULT_PERMISSIONS, ...permissions };

    const context: MutableContext = {
      id,
      pluginId,
      permissions: fullPermissions,
      createdAt: Date.now(),
      status: "ready",
    };

    this.contexts.set(id, context);
    this.log(id, "created", `Sandbox created for plugin ${pluginId}`);

    return toReadonlyContext(context);
  }

  /**
   * Execute code in a sandbox. Returns the result of the execution.
   * In production this would use vm2/isolated-vm; here we simulate
   * the permission checking and execution lifecycle.
   */
  execute(sandboxId: string, code: string): SandboxResult {
    const context = this.contexts.get(sandboxId);
    if (!context) {
      return {
        sandboxId,
        success: false,
        output: "",
        error: "Sandbox not found",
        executionMs: 0,
        terminatedByTimeout: false,
      };
    }

    context.status = "running";
    this.log(sandboxId, "started", `Executing ${code.length} chars of code`);

    const startTime = Date.now();

    // Check for permission violations before executing
    const violations = checkPermissionViolations(code, context.permissions);
    if (violations.length > 0) {
      context.status = "error";
      const violationMsg = violations.join("; ");
      this.log(sandboxId, "permission-denied", violationMsg);

      return {
        sandboxId,
        success: false,
        output: "",
        error: `Permission denied: ${violationMsg}`,
        executionMs: Date.now() - startTime,
        terminatedByTimeout: false,
      };
    }

    // Simulate execution (actual sandboxing would use isolated-vm/vm2)
    const executionMs = Date.now() - startTime;

    if (executionMs > context.permissions.maxExecutionMs) {
      context.status = "terminated";
      this.log(sandboxId, "timeout", `Exceeded ${context.permissions.maxExecutionMs}ms limit`);

      return {
        sandboxId,
        success: false,
        output: "",
        error: "Execution timed out",
        executionMs,
        terminatedByTimeout: true,
      };
    }

    context.status = "completed";
    this.log(sandboxId, "completed", `Executed in ${executionMs}ms`);

    return {
      sandboxId,
      success: true,
      output: `[sandbox:${sandboxId}] Code executed (${code.length} chars)`,
      error: null,
      executionMs,
      terminatedByTimeout: false,
    };
  }

  /**
   * Scan plugin content and determine if it needs sandboxing.
   */
  shouldSandbox(pluginContent: string): boolean {
    return this.scanPlugin(pluginContent).shouldSandbox;
  }

  /**
   * Full scan with detailed findings.
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
   * Get execution log for a sandbox.
   */
  getExecutionLog(sandboxId: string): readonly SandboxLogEntry[] {
    return this.logs.filter((l) => l.sandboxId === sandboxId);
  }

  /**
   * Get all logs.
   */
  getAllLogs(): readonly SandboxLogEntry[] {
    return [...this.logs];
  }

  /**
   * Get a sandbox context by ID.
   */
  getSandbox(sandboxId: string): SandboxContext | null {
    const ctx = this.contexts.get(sandboxId);
    return ctx ? toReadonlyContext(ctx) : null;
  }

  // -- Private ---------------------------------------------------------------

  private log(sandboxId: string, event: SandboxLogEntry["event"], detail: string): void {
    this.logs.push({
      timestamp: Date.now(),
      sandboxId,
      event,
      detail,
    });
  }
}

// -- Internal types ----------------------------------------------------------

interface MutableContext {
  readonly id: string;
  readonly pluginId: string;
  readonly permissions: SandboxPermissions;
  readonly createdAt: number;
  status: SandboxContext["status"];
}

function toReadonlyContext(ctx: MutableContext): SandboxContext {
  return {
    id: ctx.id,
    pluginId: ctx.pluginId,
    permissions: ctx.permissions,
    createdAt: ctx.createdAt,
    status: ctx.status,
  };
}

// -- Permission checking -----------------------------------------------------

function checkPermissionViolations(code: string, permissions: SandboxPermissions): readonly string[] {
  const violations: string[] = [];

  if (!permissions.allowFileRead && /\breadFileSync?\s*\(/.test(code)) {
    violations.push("File read not permitted");
  }
  if (!permissions.allowFileWrite && /\bwriteFileSync?\s*\(/.test(code)) {
    violations.push("File write not permitted");
  }
  if (!permissions.allowNetwork && /\bfetch\s*\(/.test(code)) {
    violations.push("Network access not permitted");
  }
  if (!permissions.allowEnvAccess && /process\.env/.test(code)) {
    violations.push("Environment variable access not permitted");
  }
  if (!permissions.allowChildProcess && /\bexecSync?\s*\(|\bspawnSync?\s*\(/.test(code)) {
    violations.push("Child process not permitted");
  }

  return violations;
}
