/**
 * Agent Fleet Dashboard — monitor multiple parallel agents in real-time.
 *
 * Tracks agent statuses, token usage, costs, and task completion.
 * Renders formatted text suitable for TUI display.
 */

// ── Types ─────────────────────────────────────────────────

export interface AgentStatus {
  readonly id: string;
  readonly role: string;
  readonly task: string;
  readonly state: "idle" | "active" | "completed" | "failed" | "waiting";
  readonly tokensUsed: number;
  readonly cost: number;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly lastActivity: string;
  readonly progress: number;
}

export interface AgentFleetStatus {
  readonly agents: readonly AgentStatus[];
  readonly totalActive: number;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
}

// ── Dashboard ─────────────────────────────────────────────

export class AgentFleetDashboard {
  private readonly agents: Map<string, AgentStatus> = new Map();

  /**
   * Register a new agent in the fleet.
   */
  registerAgent(id: string, role: string, task: string): void {
    const status: AgentStatus = {
      id,
      role,
      task,
      state: "idle",
      tokensUsed: 0,
      cost: 0,
      startedAt: Date.now(),
      completedAt: null,
      lastActivity: "Registered",
      progress: 0,
    };
    this.agents.set(id, status);
  }

  /**
   * Update an existing agent's status.
   * Creates a new immutable record (no mutation).
   */
  updateAgent(id: string, update: Partial<AgentStatus>): void {
    const existing = this.agents.get(id);
    if (!existing) return;

    this.agents.set(id, { ...existing, ...update });
  }

  /**
   * Remove an agent from the fleet.
   */
  removeAgent(id: string): void {
    this.agents.delete(id);
  }

  /**
   * Get aggregated fleet status.
   */
  getFleetStatus(): AgentFleetStatus {
    const agents = [...this.agents.values()];

    return {
      agents,
      totalActive: agents.filter((a) => a.state === "active").length,
      totalTokens: agents.reduce((sum, a) => sum + a.tokensUsed, 0),
      totalCost: agents.reduce((sum, a) => sum + a.cost, 0),
      completedTasks: agents.filter((a) => a.state === "completed").length,
      failedTasks: agents.filter((a) => a.state === "failed").length,
    };
  }

  /**
   * Get status for a single agent.
   */
  getAgentStatus(id: string): AgentStatus | undefined {
    return this.agents.get(id);
  }

  /**
   * Get count of registered agents.
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Render the fleet dashboard as formatted text for TUI.
   */
  renderDashboard(): string {
    const status = this.getFleetStatus();
    const lines: string[] = [];

    // Header
    lines.push("=== Agent Fleet Dashboard ===");
    lines.push("");

    // Summary line
    lines.push(
      `Active: ${status.totalActive} | ` +
        `Completed: ${status.completedTasks} | ` +
        `Failed: ${status.failedTasks} | ` +
        `Tokens: ${formatTokens(status.totalTokens)} | ` +
        `Cost: $${status.totalCost.toFixed(4)}`,
    );
    lines.push("");

    // Agent table
    if (status.agents.length === 0) {
      lines.push("  No agents registered.");
    } else {
      lines.push(
        padRight("ID", 16) +
          padRight("Role", 14) +
          padRight("State", 12) +
          padRight("Progress", 10) +
          padRight("Tokens", 10) +
          "Task",
      );
      lines.push("-".repeat(80));

      for (const agent of status.agents) {
        const stateIcon = getStateIcon(agent.state);
        const progressBar = renderProgressBar(agent.progress, 8);

        lines.push(
          padRight(agent.id.slice(0, 14), 16) +
            padRight(agent.role.slice(0, 12), 14) +
            padRight(`${stateIcon} ${agent.state}`, 12) +
            padRight(progressBar, 10) +
            padRight(formatTokens(agent.tokensUsed), 10) +
            agent.task.slice(0, 30),
        );
      }
    }

    lines.push("");
    lines.push(`Last updated: ${new Date().toISOString()}`);

    return lines.join("\n");
  }
}

// ── Formatting Helpers ────────────────────────────────────

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function getStateIcon(state: AgentStatus["state"]): string {
  const icons: Record<AgentStatus["state"], string> = {
    idle: "o",
    active: ">",
    completed: "+",
    failed: "x",
    waiting: "~",
  };
  return icons[state];
}

function renderProgressBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return `[${"#".repeat(filled)}${".".repeat(empty)}]`;
}

function padRight(str: string, length: number): string {
  if (str.length >= length) return str.slice(0, length);
  return str + " ".repeat(length - str.length);
}
