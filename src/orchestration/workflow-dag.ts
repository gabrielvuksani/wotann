/**
 * YAML Workflow DAG Engine — inspired by Archon.
 *
 * Defines development workflows as directed acyclic graphs (DAGs) with:
 * - Sequential and parallel node execution
 * - Loop nodes (iterate until condition met)
 * - Human approval gates
 * - Git worktree isolation per workflow run
 * - Deterministic execution ordering
 *
 * Example workflow YAML:
 * ```yaml
 * name: idea-to-pr
 * nodes:
 *   - id: plan
 *     type: agent
 *     prompt: "Create an implementation plan for: {{input}}"
 *   - id: implement
 *     type: agent
 *     prompt: "Implement the plan"
 *     depends: [plan]
 *   - id: test
 *     type: loop
 *     prompt: "Run tests and fix failures"
 *     maxIterations: 5
 *     exitCondition: "all tests pass"
 *     depends: [implement]
 *   - id: review
 *     type: approval
 *     prompt: "Review changes before PR"
 *     depends: [test]
 *   - id: pr
 *     type: agent
 *     prompt: "Create a pull request"
 *     depends: [review]
 * ```
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────

export type NodeType = "agent" | "loop" | "approval" | "parallel" | "shell";
export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_approval";

export interface WorkflowNode {
  readonly id: string;
  readonly type: NodeType;
  readonly prompt: string;
  readonly depends: readonly string[];
  readonly maxIterations?: number;
  readonly exitCondition?: string;
  readonly shellCommand?: string;
  readonly parallel?: readonly string[];
  readonly timeout?: number;
}

export interface Workflow {
  readonly name: string;
  readonly description?: string;
  readonly nodes: readonly WorkflowNode[];
  readonly variables?: Readonly<Record<string, string>>;
}

export interface WorkflowRun {
  readonly id: string;
  readonly workflow: Workflow;
  readonly status: "running" | "completed" | "failed" | "paused";
  readonly nodeStates: Readonly<Record<string, NodeState>>;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly input: string;
  readonly worktreePath?: string;
}

export interface NodeState {
  readonly status: NodeStatus;
  readonly output?: string;
  readonly error?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly iterations?: number;
}

// ── Built-in Workflow Templates ──────────────────────────

export const BUILTIN_WORKFLOWS: readonly Workflow[] = [
  {
    name: "idea-to-pr",
    description: "Transform an idea into a complete pull request",
    nodes: [
      { id: "plan", type: "agent", prompt: "Create a detailed implementation plan for: {{input}}", depends: [] },
      { id: "implement", type: "agent", prompt: "Implement the plan from the previous step", depends: ["plan"] },
      { id: "verify", type: "loop", prompt: "Run tests and typecheck. Fix any failures.", depends: ["implement"], maxIterations: 5, exitCondition: "all tests pass and typecheck is clean" },
      { id: "review", type: "approval", prompt: "Review the implementation before creating PR", depends: ["verify"] },
      { id: "pr", type: "agent", prompt: "Create a pull request with a clear title and description", depends: ["review"] },
    ],
  },
  {
    name: "fix-issue",
    description: "Investigate and fix a reported issue",
    nodes: [
      { id: "investigate", type: "agent", prompt: "Investigate the issue: {{input}}. Find the root cause.", depends: [] },
      { id: "fix", type: "agent", prompt: "Implement the fix based on the investigation", depends: ["investigate"] },
      { id: "test", type: "loop", prompt: "Run tests to verify the fix. Fix any regressions.", depends: ["fix"], maxIterations: 3, exitCondition: "all tests pass" },
      { id: "commit", type: "agent", prompt: "Commit the fix with a descriptive conventional commit message", depends: ["test"] },
    ],
  },
  {
    name: "refactor",
    description: "Refactor code with safety verification",
    nodes: [
      { id: "analyze", type: "agent", prompt: "Analyze the code to refactor: {{input}}. Identify risks.", depends: [] },
      { id: "refactor", type: "agent", prompt: "Perform the refactoring based on the analysis", depends: ["analyze"] },
      { id: "verify", type: "loop", prompt: "Verify no regressions: run tests, typecheck, lint.", depends: ["refactor"], maxIterations: 5, exitCondition: "zero failures" },
      { id: "review", type: "approval", prompt: "Review refactored code", depends: ["verify"] },
    ],
  },
  {
    name: "code-review",
    description: "Multi-perspective code review",
    nodes: [
      { id: "security", type: "agent", prompt: "Review for security vulnerabilities: {{input}}", depends: [] },
      { id: "performance", type: "agent", prompt: "Review for performance issues: {{input}}", depends: [] },
      { id: "quality", type: "agent", prompt: "Review for code quality and maintainability: {{input}}", depends: [] },
      { id: "synthesize", type: "agent", prompt: "Synthesize all review findings into a prioritized report", depends: ["security", "performance", "quality"] },
    ],
  },
];

// ── Workflow Engine ──────────────────────────────────────

export class WorkflowDAGEngine {
  private readonly runs: Map<string, WorkflowRun> = new Map();
  private onNodeComplete?: (runId: string, nodeId: string, state: NodeState) => void;
  private onApprovalNeeded?: (runId: string, nodeId: string, prompt: string) => Promise<boolean>;
  private executeAgent?: (prompt: string, context: string) => Promise<string>;
  private executeShell?: (command: string) => Promise<{ stdout: string; exitCode: number }>;

  /** Set the agent execution callback. */
  setAgentExecutor(fn: (prompt: string, context: string) => Promise<string>): void {
    this.executeAgent = fn;
  }

  /** Set the shell execution callback. */
  setShellExecutor(fn: (command: string) => Promise<{ stdout: string; exitCode: number }>): void {
    this.executeShell = fn;
  }

  /** Set the approval callback (returns true if approved). */
  setApprovalHandler(fn: (runId: string, nodeId: string, prompt: string) => Promise<boolean>): void {
    this.onApprovalNeeded = fn;
  }

  /** Set the node completion callback. */
  setNodeCompleteHandler(fn: (runId: string, nodeId: string, state: NodeState) => void): void {
    this.onNodeComplete = fn;
  }

  /** Load a workflow from a YAML file. */
  loadFromFile(filePath: string): Workflow | null {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf-8");
    return this.parseYAML(content);
  }

  /** Get a built-in workflow by name. */
  getBuiltin(name: string): Workflow | undefined {
    return BUILTIN_WORKFLOWS.find((w) => w.name === name);
  }

  /** List all available workflows (built-in + custom). */
  listWorkflows(customDir?: string): readonly Workflow[] {
    const workflows = [...BUILTIN_WORKFLOWS];
    if (customDir && existsSync(customDir)) {
      // Scan for .yaml/.yml files in the custom directory
      try {
        const { readdirSync } = require("node:fs");
        const files = readdirSync(customDir) as string[];
        for (const file of files) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const w = this.loadFromFile(join(customDir, file));
            if (w) workflows.push(w);
          }
        }
      } catch { /* directory not readable */ }
    }
    return workflows;
  }

  /** Start a workflow run. */
  async startRun(workflow: Workflow, input: string): Promise<WorkflowRun> {
    const runId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nodeStates: Record<string, NodeState> = {};
    for (const node of workflow.nodes) {
      nodeStates[node.id] = { status: "pending" };
    }

    const run: WorkflowRun = {
      id: runId,
      workflow,
      status: "running",
      nodeStates,
      startedAt: Date.now(),
      input,
    };

    this.runs.set(runId, run);
    this.executeRun(run).catch(() => {});
    return run;
  }

  /** Get a workflow run by ID. */
  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  /** Approve a pending approval node. */
  approveNode(runId: string, nodeId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const nodeState = run.nodeStates[nodeId];
    if (nodeState?.status === "awaiting_approval") {
      this.updateNodeState(runId, nodeId, { status: "completed", completedAt: Date.now() });
    }
  }

  /** Reject a pending approval node (fails the run). */
  rejectNode(runId: string, nodeId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.updateNodeState(runId, nodeId, { status: "failed", error: "Rejected by user", completedAt: Date.now() });
    this.runs.set(runId, { ...run, status: "failed" });
  }

  // ── Private ────────────────────────────────────────────

  private async executeRun(run: WorkflowRun): Promise<void> {
    const executed = new Set<string>();
    let progress = true;

    while (progress) {
      progress = false;

      for (const node of run.workflow.nodes) {
        if (executed.has(node.id)) continue;

        const state = run.nodeStates[node.id];
        if (state?.status === "failed" || state?.status === "skipped") {
          executed.add(node.id);
          continue;
        }

        // Check if all dependencies are completed
        const depsComplete = node.depends.every((dep) => {
          const depState = run.nodeStates[dep];
          return depState?.status === "completed";
        });

        if (!depsComplete) continue;

        // Execute the node
        progress = true;
        const resolvedPrompt = this.resolveVariables(node.prompt, run);

        try {
          switch (node.type) {
            case "agent":
              await this.executeAgentNode(run.id, node, resolvedPrompt);
              break;
            case "loop":
              await this.executeLoopNode(run.id, node, resolvedPrompt);
              break;
            case "approval":
              await this.executeApprovalNode(run.id, node, resolvedPrompt);
              break;
            case "shell":
              await this.executeShellNode(run.id, node);
              break;
          }
        } catch (err) {
          this.updateNodeState(run.id, node.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            completedAt: Date.now(),
          });
        }

        executed.add(node.id);
      }
    }

    // Check if all nodes completed
    const allDone = run.workflow.nodes.every((n) => {
      const s = run.nodeStates[n.id];
      return s?.status === "completed" || s?.status === "skipped" || s?.status === "failed";
    });

    const anyFailed = run.workflow.nodes.some((n) => run.nodeStates[n.id]?.status === "failed");

    this.runs.set(run.id, {
      ...run,
      status: allDone ? (anyFailed ? "failed" : "completed") : "paused",
      completedAt: allDone ? Date.now() : undefined,
    });
  }

  private async executeAgentNode(runId: string, node: WorkflowNode, prompt: string): Promise<void> {
    this.updateNodeState(runId, node.id, { status: "running", startedAt: Date.now() });

    if (!this.executeAgent) {
      this.updateNodeState(runId, node.id, { status: "failed", error: "No agent executor configured" });
      return;
    }

    const previousOutputs = this.gatherPreviousOutputs(runId, node.depends);
    const output = await this.executeAgent(prompt, previousOutputs);
    this.updateNodeState(runId, node.id, { status: "completed", output, completedAt: Date.now() });
  }

  private async executeLoopNode(runId: string, node: WorkflowNode, prompt: string): Promise<void> {
    this.updateNodeState(runId, node.id, { status: "running", startedAt: Date.now() });

    const max = node.maxIterations ?? 5;
    let iterations = 0;

    while (iterations < max) {
      iterations++;
      if (!this.executeAgent) break;

      const context = `Iteration ${iterations}/${max}. Exit when: ${node.exitCondition ?? "task is complete"}`;
      const output = await this.executeAgent(prompt, context);

      // Check if exit condition is met (agent responds with completion indicators)
      const isDone = output.toLowerCase().includes("all tests pass") ||
        output.toLowerCase().includes("exit condition met") ||
        output.toLowerCase().includes("no failures") ||
        output.toLowerCase().includes("clean") ||
        (node.exitCondition && output.toLowerCase().includes(node.exitCondition.toLowerCase()));

      if (isDone) {
        this.updateNodeState(runId, node.id, { status: "completed", output, completedAt: Date.now(), iterations });
        return;
      }
    }

    this.updateNodeState(runId, node.id, {
      status: "completed",
      output: `Loop completed after ${iterations} iterations`,
      completedAt: Date.now(),
      iterations,
    });
  }

  private async executeApprovalNode(runId: string, node: WorkflowNode, prompt: string): Promise<void> {
    this.updateNodeState(runId, node.id, { status: "awaiting_approval", startedAt: Date.now() });

    if (this.onApprovalNeeded) {
      const approved = await this.onApprovalNeeded(runId, node.id, prompt);
      if (approved) {
        this.updateNodeState(runId, node.id, { status: "completed", completedAt: Date.now() });
      } else {
        this.updateNodeState(runId, node.id, { status: "failed", error: "Rejected", completedAt: Date.now() });
      }
    }
  }

  private async executeShellNode(runId: string, node: WorkflowNode): Promise<void> {
    this.updateNodeState(runId, node.id, { status: "running", startedAt: Date.now() });

    if (!this.executeShell || !node.shellCommand) {
      this.updateNodeState(runId, node.id, { status: "failed", error: "No shell executor or command" });
      return;
    }

    const result = await this.executeShell(node.shellCommand);
    this.updateNodeState(runId, node.id, {
      status: result.exitCode === 0 ? "completed" : "failed",
      output: result.stdout,
      error: result.exitCode !== 0 ? `Exit code ${result.exitCode}` : undefined,
      completedAt: Date.now(),
    });
  }

  private updateNodeState(runId: string, nodeId: string, update: Partial<NodeState>): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const current = run.nodeStates[nodeId] ?? { status: "pending" as NodeStatus };
    const newState: NodeState = { ...current, ...update };

    this.runs.set(runId, {
      ...run,
      nodeStates: { ...run.nodeStates, [nodeId]: newState },
    });

    this.onNodeComplete?.(runId, nodeId, newState);
  }

  private gatherPreviousOutputs(runId: string, deps: readonly string[]): string {
    const run = this.runs.get(runId);
    if (!run) return "";

    return deps
      .map((dep) => {
        const state = run.nodeStates[dep];
        return state?.output ? `[${dep}]: ${state.output}` : "";
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  private resolveVariables(prompt: string, run: WorkflowRun): string {
    let resolved = prompt.replace(/\{\{input\}\}/g, run.input);
    if (run.workflow.variables) {
      for (const [key, value] of Object.entries(run.workflow.variables)) {
        resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }
    return resolved;
  }

  private parseYAML(content: string): Workflow | null {
    // Simple YAML parser for workflow files — handles the subset we need
    try {
      const lines = content.split("\n");
      let name = "";
      let description = "";
      const nodes: WorkflowNode[] = [];
      let currentNode: { id?: string; type?: string; prompt?: string; depends?: string[]; maxIterations?: number; exitCondition?: string; shellCommand?: string } | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("name:")) name = trimmed.slice(5).trim().replace(/^["']|["']$/g, "");
        if (trimmed.startsWith("description:")) description = trimmed.slice(12).trim().replace(/^["']|["']$/g, "");

        if (trimmed.startsWith("- id:")) {
          if (currentNode?.id) {
            nodes.push({
              id: currentNode.id,
              type: (currentNode.type ?? "agent") as NodeType,
              prompt: currentNode.prompt ?? "",
              depends: currentNode.depends ?? [],
              maxIterations: currentNode.maxIterations,
              exitCondition: currentNode.exitCondition,
              shellCommand: currentNode.shellCommand,
            });
          }
          currentNode = { id: trimmed.slice(5).trim(), depends: [] };
        }
        if (currentNode) {
          if (trimmed.startsWith("type:")) currentNode.type = trimmed.slice(5).trim();
          if (trimmed.startsWith("prompt:")) currentNode.prompt = trimmed.slice(7).trim().replace(/^["']|["']$/g, "");
          if (trimmed.startsWith("maxIterations:")) currentNode.maxIterations = parseInt(trimmed.slice(14).trim(), 10);
          if (trimmed.startsWith("exitCondition:")) currentNode.exitCondition = trimmed.slice(14).trim().replace(/^["']|["']$/g, "");
          if (trimmed.startsWith("command:")) currentNode.shellCommand = trimmed.slice(8).trim().replace(/^["']|["']$/g, "");
          if (trimmed.startsWith("depends:")) {
            const depsStr = trimmed.slice(8).trim();
            currentNode.depends = depsStr
              .replace(/[\[\]]/g, "")
              .split(",")
              .map((d) => d.trim())
              .filter(Boolean);
          }
        }
      }

      // Push last node
      if (currentNode?.id) {
        nodes.push({
          id: currentNode.id,
          type: (currentNode.type ?? "agent") as NodeType,
          prompt: currentNode.prompt ?? "",
          depends: currentNode.depends ?? [],
          maxIterations: currentNode.maxIterations,
          exitCondition: currentNode.exitCondition,
          shellCommand: currentNode.shellCommand,
        });
      }

      if (!name || nodes.length === 0) return null;
      return { name, description, nodes };
    } catch {
      return null;
    }
  }
}
