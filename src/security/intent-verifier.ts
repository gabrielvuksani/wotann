/**
 * Intent Verifier — Verify agent's stated intent matches actual actions (DX2).
 * Inspired by NemoClaw's per-action intent verification.
 *
 * Detects drift between what the agent says it's doing and what it actually does:
 * - "reviewing code" but running destructive commands
 * - "writing tests" but modifying production code
 * - Accessing files unrelated to stated goal
 * - Escalating privileges without explanation
 * - Repeated identical actions (loop detection)
 *
 * Maintains a rolling suspicion score that aggregates across actions.
 */

// ── Types ────────────────────────────────────────────────

export interface IntentContext {
  readonly statedGoal: string;
  readonly recentActions: readonly ActionRecord[];
  readonly currentAction: PendingAction;
}

export interface ActionRecord {
  readonly tool: string;
  readonly args: string;
  readonly timestamp: number;
  readonly approved: boolean;
  readonly suspicionScore: number;
}

export interface PendingAction {
  readonly tool: string;
  readonly args: string;
  readonly description?: string;
}

export interface VerificationResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly riskLevel: "safe" | "moderate" | "suspicious" | "dangerous";
  readonly suggestedAlternative?: string;
}

/**
 * Spec-required return type for verifyAction.
 */
export interface IntentVerification {
  readonly statedGoal: string;
  readonly actualAction: string;
  readonly aligned: boolean;
  readonly suspicionScore: number; // 0-1
  readonly reason: string;
}

// ── Suspicious Patterns ──────────────────────────────────

interface SuspiciousPattern {
  readonly name: string;
  readonly toolPattern: RegExp;
  readonly argPattern: RegExp;
  readonly riskLevel: "moderate" | "suspicious" | "dangerous";
  readonly description: string;
}

const SUSPICIOUS_PATTERNS: readonly SuspiciousPattern[] = [
  {
    name: "recursive-delete",
    toolPattern: /^(bash|shell)$/,
    argPattern: /rm\s+(-rf|-fr|--recursive.*--force|--force.*--recursive)/i,
    riskLevel: "dangerous",
    description: "Recursive forced deletion",
  },
  {
    name: "force-push",
    toolPattern: /^(bash|shell)$/,
    argPattern: /git\s+push\s+.*--force/i,
    riskLevel: "dangerous",
    description: "Force push to remote",
  },
  {
    name: "database-drop",
    toolPattern: /^(bash|shell)$/,
    argPattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i,
    riskLevel: "dangerous",
    description: "Database schema destruction",
  },
  {
    name: "env-exfiltration",
    toolPattern: /^(bash|shell)$/,
    argPattern: /(curl|wget|fetch).*\$\{?(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS)/i,
    riskLevel: "dangerous",
    description: "Potential secret exfiltration via HTTP",
  },
  {
    name: "process-kill",
    toolPattern: /^(bash|shell)$/,
    argPattern: /kill\s+-9|killall|pkill/i,
    riskLevel: "suspicious",
    description: "Force killing processes",
  },
  {
    name: "system-modification",
    toolPattern: /^(bash|shell)$/,
    argPattern: /chmod\s+777|chown\s+root|sudo\s/i,
    riskLevel: "suspicious",
    description: "System-level permission change",
  },
  {
    name: "network-scan",
    toolPattern: /^(bash|shell)$/,
    argPattern: /nmap|netcat|nc\s+-|masscan/i,
    riskLevel: "moderate",
    description: "Network scanning activity",
  },
];

// ── Goal-Action Alignment ────────────────────────────────

interface GoalCategory {
  readonly keywords: readonly string[];
  readonly allowedTools: readonly string[];
  readonly blockedPatterns: readonly string[];
}

const GOAL_CATEGORIES: readonly GoalCategory[] = [
  {
    keywords: ["review", "read", "analyze", "check", "inspect", "audit"],
    allowedTools: ["read_file", "grep", "glob", "bash", "git_log", "git_diff"],
    blockedPatterns: ["write_file", "edit_file", "delete_file", "bash.*rm"],
  },
  {
    keywords: ["test", "verify", "check", "validate"],
    allowedTools: ["bash", "read_file", "grep"],
    blockedPatterns: ["delete_file", "bash.*rm", "bash.*drop"],
  },
  {
    keywords: ["fix", "implement", "create", "build", "add", "write"],
    allowedTools: ["read_file", "write_file", "edit_file", "bash", "grep", "glob"],
    blockedPatterns: ["bash.*rm.*-rf", "bash.*drop.*table", "bash.*force.*push"],
  },
];

// ── Verifier ─────────────────────────────────────────────

export class IntentVerifier {
  private readonly actionHistory: ActionRecord[] = [];
  private readonly goalStack: string[] = [];
  private statedGoal = "";

  /**
   * Set the current stated goal of the agent.
   * Pushes previous goal onto the stack for nested goal tracking.
   */
  setGoal(goal: string): void {
    if (this.statedGoal.length > 0) {
      this.goalStack.push(this.statedGoal);
    }
    this.statedGoal = goal.toLowerCase();
  }

  /**
   * Pop back to the previous goal (for nested sub-tasks).
   */
  popGoal(): string | undefined {
    const previous = this.goalStack.pop();
    if (previous !== undefined) {
      this.statedGoal = previous;
    }
    return previous;
  }

  /**
   * Get the current goal stack depth (for diagnostics).
   */
  getGoalStackDepth(): number {
    return this.goalStack.length;
  }

  /**
   * Verify if a pending action is consistent with the stated goal.
   */
  verify(action: PendingAction): VerificationResult {
    // Check against suspicious patterns first
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.toolPattern.test(action.tool) && pattern.argPattern.test(action.args)) {
        return {
          allowed: pattern.riskLevel !== "dangerous",
          reason: `${pattern.description} detected. ${pattern.riskLevel === "dangerous" ? "Blocked for safety." : "Proceed with caution."}`,
          riskLevel: pattern.riskLevel,
        };
      }
    }

    // Check goal-action alignment
    if (this.statedGoal) {
      for (const category of GOAL_CATEGORIES) {
        const goalMatches = category.keywords.some((kw) => this.statedGoal.includes(kw));
        if (goalMatches) {
          // Check if the action's tool is blocked for this goal type
          for (const blocked of category.blockedPatterns) {
            const blockRegex = new RegExp(blocked, "i");
            const combined = `${action.tool} ${action.args}`;
            if (blockRegex.test(combined)) {
              return {
                allowed: false,
                reason: `Action "${action.tool}" with these arguments conflicts with goal "${this.statedGoal}". The goal suggests read-only operations but the action would modify files.`,
                riskLevel: "suspicious",
                suggestedAlternative: "Consider using read-only tools like grep or read_file instead.",
              };
            }
          }
        }
      }
    }

    // Check for drift — same command repeated 3+ times
    const recentSame = this.actionHistory
      .slice(-5)
      .filter((a) => a.tool === action.tool && a.args === action.args);
    if (recentSame.length >= 3) {
      return {
        allowed: false,
        reason: "Same action repeated 3+ times. Possible loop detected.",
        riskLevel: "moderate",
        suggestedAlternative: "Try a different approach to achieve the goal.",
      };
    }

    // Safe by default
    return {
      allowed: true,
      reason: "Action is consistent with stated intent.",
      riskLevel: "safe",
    };
  }

  /**
   * Verify an action and return spec-compliant IntentVerification.
   * This wraps verify() with the structured return type.
   */
  verifyAction(toolName: string, args: Record<string, unknown>): IntentVerification {
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);
    const action: PendingAction = { tool: toolName, args: argsStr };
    const result = this.verify(action);

    const suspicionScore = riskLevelToScore(result.riskLevel);
    this.recordAction(action, result.allowed, suspicionScore);

    return {
      statedGoal: this.statedGoal,
      actualAction: `${toolName}: ${argsStr.slice(0, 200)}`,
      aligned: result.allowed,
      suspicionScore,
      reason: result.reason,
    };
  }

  /**
   * Record a completed action for history tracking.
   */
  recordAction(action: PendingAction, approved: boolean, suspicionScore?: number): void {
    this.actionHistory.push({
      tool: action.tool,
      args: action.args,
      timestamp: Date.now(),
      approved,
      suspicionScore: suspicionScore ?? 0,
    });

    // Keep only last 50 actions
    if (this.actionHistory.length > 50) {
      this.actionHistory.splice(0, this.actionHistory.length - 50);
    }
  }

  /**
   * Get aggregate suspicion score across recent actions.
   * Returns a value between 0 (fully trusted) and 1 (highly suspicious).
   * Uses exponential decay: recent actions matter more than older ones.
   */
  getSuspicionLevel(): number {
    if (this.actionHistory.length === 0) return 0;

    const recentActions = this.actionHistory.slice(-20);
    let weightedSum = 0;
    let totalWeight = 0;
    const decayFactor = 0.85;

    for (let i = 0; i < recentActions.length; i++) {
      const action = recentActions[i]!;
      const weight = Math.pow(decayFactor, recentActions.length - 1 - i);
      weightedSum += action.suspicionScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.min(1, weightedSum / totalWeight) : 0;
  }

  /**
   * Get the current risk assessment summary.
   */
  getRiskSummary(): { safe: number; moderate: number; suspicious: number; dangerous: number } {
    const counts = { safe: 0, moderate: 0, suspicious: 0, dangerous: 0 };
    for (const action of this.actionHistory) {
      const result = this.verify({ tool: action.tool, args: action.args });
      counts[result.riskLevel]++;
    }
    return counts;
  }

  /**
   * Reset the verifier for a new session.
   */
  reset(): void {
    this.actionHistory.length = 0;
    this.goalStack.length = 0;
    this.statedGoal = "";
  }
}

// ── Helpers ─────────────────────────────────────────────

function riskLevelToScore(level: string): number {
  switch (level) {
    case "dangerous": return 1.0;
    case "suspicious": return 0.7;
    case "moderate": return 0.3;
    default: return 0;
  }
}
