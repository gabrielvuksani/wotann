/**
 * Execution Environments (C11) — Local / Worktree / Docker radio
 * per task.
 *
 * Air's innovation: let the user pick the blast radius of each task
 * at dispatch time. Local runs in the actual working tree (fast, no
 * isolation). Worktree uses a git worktree (isolation, cheap). Docker
 * runs in a container (full isolation, slower, best for destructive
 * ops).
 *
 * This module owns:
 *   - the three environment descriptors
 *   - a pure `chooseEnvironment(riskLevel, hint)` selector
 *   - a `describePlan(choice)` renderer for the confirmation prompt
 *
 * Runtime wiring (TaskIsolationManager.createIsolation, Docker backend,
 * etc.) already exists — this just adds the front-of-house decision
 * layer so the agent can route before dispatch.
 */

export type ExecutionEnvName = "local" | "worktree" | "docker";

export type RiskLevel = "safe" | "caution" | "dangerous" | "destructive";

export interface ExecutionEnvironment {
  readonly name: ExecutionEnvName;
  readonly label: string;
  readonly description: string;
  readonly isolation: "none" | "filesystem" | "full";
  readonly startupCostMs: number; // typical overhead to spin up
  readonly supportsRollback: boolean;
  readonly tradeoffs: readonly string[];
}

export const EXECUTION_ENVIRONMENTS: Record<ExecutionEnvName, ExecutionEnvironment> = {
  local: {
    name: "local",
    label: "Local",
    description: "Runs in the actual working tree",
    isolation: "none",
    startupCostMs: 0,
    supportsRollback: false,
    tradeoffs: [
      "Fastest path — no setup overhead",
      "No isolation: mistakes hit your real files",
      "Best for: small edits, Read/Grep flows",
    ],
  },
  worktree: {
    name: "worktree",
    label: "Worktree",
    description: "Isolated git worktree; merged only on verification",
    isolation: "filesystem",
    startupCostMs: 2_500,
    supportsRollback: true,
    tradeoffs: [
      "Filesystem isolation via git worktree",
      "~2.5s setup; merge on success",
      "Best for: multi-file edits, refactors, new features",
    ],
  },
  docker: {
    name: "docker",
    label: "Docker",
    description: "Full container isolation with optional network lockdown",
    isolation: "full",
    startupCostMs: 8_000,
    supportsRollback: true,
    tradeoffs: [
      "Full process + filesystem isolation",
      "~8s setup; can block outbound network",
      "Best for: destructive shell ops, untrusted scripts",
    ],
  },
};

// ── Selector ────────────────────────────────────────────────

export interface SelectorHint {
  readonly hasDestructiveOps?: boolean;
  readonly touchesManyFiles?: boolean;
  readonly userRequested?: ExecutionEnvName;
  readonly dockerAvailable?: boolean;
}

export interface EnvironmentChoice {
  readonly env: ExecutionEnvironment;
  readonly reason: string;
  readonly alternatives: readonly ExecutionEnvName[];
}

/**
 * Pure selector. User request wins; otherwise routes by risk + scope.
 *   - destructive or destructive-ops hint → docker (fallback worktree
 *     when Docker unavailable)
 *   - dangerous or touches many files → worktree
 *   - safe small edits → local
 */
export function chooseEnvironment(risk: RiskLevel, hint: SelectorHint = {}): EnvironmentChoice {
  if (hint.userRequested) {
    return {
      env: EXECUTION_ENVIRONMENTS[hint.userRequested],
      reason: "user requested this environment",
      alternatives: altsExcluding(hint.userRequested),
    };
  }

  if (risk === "destructive" || hint.hasDestructiveOps) {
    if (hint.dockerAvailable === false) {
      return {
        env: EXECUTION_ENVIRONMENTS.worktree,
        reason: "destructive risk; Docker unavailable — falling back to worktree",
        alternatives: ["local", "docker"],
      };
    }
    return {
      env: EXECUTION_ENVIRONMENTS.docker,
      reason: "destructive risk — full container isolation",
      alternatives: ["worktree", "local"],
    };
  }

  if (risk === "dangerous" || hint.touchesManyFiles) {
    return {
      env: EXECUTION_ENVIRONMENTS.worktree,
      reason:
        risk === "dangerous"
          ? "dangerous operations — isolated worktree"
          : "multi-file change — isolated worktree for clean rollback",
      alternatives: ["local", "docker"],
    };
  }

  if (risk === "caution") {
    return {
      env: EXECUTION_ENVIRONMENTS.worktree,
      reason: "caution-level risk — worktree for safety",
      alternatives: ["local", "docker"],
    };
  }

  return {
    env: EXECUTION_ENVIRONMENTS.local,
    reason: "safe task — no isolation needed",
    alternatives: ["worktree", "docker"],
  };
}

function altsExcluding(name: ExecutionEnvName): readonly ExecutionEnvName[] {
  return (["local", "worktree", "docker"] as const).filter((n) => n !== name);
}

// ── Renderer ────────────────────────────────────────────────

export function describePlan(choice: EnvironmentChoice): string {
  const alts = choice.alternatives.map((n) => EXECUTION_ENVIRONMENTS[n].label).join(", ");
  const lines = [
    `Execution environment: ${choice.env.label} (${choice.env.isolation} isolation)`,
    `  Reason: ${choice.reason}`,
    `  Setup cost: ~${choice.env.startupCostMs}ms`,
    `  Rollback: ${choice.env.supportsRollback ? "yes" : "no"}`,
    `  Alternatives: ${alts}`,
  ];
  return lines.join("\n");
}

export function listAllEnvironments(): readonly ExecutionEnvironment[] {
  return [
    EXECUTION_ENVIRONMENTS.local,
    EXECUTION_ENVIRONMENTS.worktree,
    EXECUTION_ENVIRONMENTS.docker,
  ];
}
