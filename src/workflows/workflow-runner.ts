/**
 * Archon-style YAML workflow runner — Phase 9.
 *
 * Archon (https://github.com/coleam00/archon) demonstrated that much of
 * agent orchestration reduces to a declarative DAG: "do A, then B, then
 * if-C-fails-loop-back-to-A". Free-form conversational planning often
 * drifts; a YAML spec keeps every run reproducible and auditable.
 *
 * Supported node types:
 *   - prompt:       send a prompt to the agent (runtime.query)
 *   - bash:         run a shell command (captured stdout/stderr/exit)
 *   - interactive:  pause for user input (caller provides callback)
 *   - loop-until:   re-run inner nodes until a condition returns true
 *   - parallel:     run children concurrently
 *   - sequence:     run children serially (default for top-level)
 *
 * Dependencies: each node can declare `depends_on: [id1, id2]` — the
 * executor resolves a topological order and errors on cycles.
 *
 * This module is PURE — no fs, no child_process. Callers provide:
 *   - runPrompt(prompt) → string                       (LLM call)
 *   - runBash(cmd) → {stdout, stderr, exitCode}        (shell)
 *   - runInteractive(nodeId) → string                  (user input)
 *   - fs.readFile                                      (YAML loading)
 *
 * Seed workflows live under src/workflows/seed/.
 *
 * Condition DSL uses explicit string-pattern matching (no dynamic code
 * execution) so untrusted YAML can't escape the sandbox.
 */

import { parse as parseYaml } from "yaml";

// ── Types ──────────────────────────────────────────────

export type WorkflowNodeKind =
  | "prompt"
  | "bash"
  | "interactive"
  | "loop-until"
  | "parallel"
  | "sequence";

export interface WorkflowNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly depends_on?: readonly string[];
  readonly prompt?: string;
  readonly bash?: string;
  readonly interactive?: string;
  readonly condition?: string;
  readonly max_iterations?: number;
  readonly children?: readonly WorkflowNode[];
  readonly timeout_ms?: number;
  readonly continue_on_error?: boolean;
}

export interface Workflow {
  readonly name: string;
  readonly description?: string;
  readonly nodes: readonly WorkflowNode[];
  readonly version?: string;
}

export interface NodeResult {
  readonly nodeId: string;
  readonly output: string;
  readonly error?: string;
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly iterations?: number;
}

export interface RunContext {
  readonly results: ReadonlyMap<string, NodeResult>;
  readonly state: Record<string, unknown>;
}

export interface WorkflowExecutors {
  readonly runPrompt: (prompt: string) => Promise<string>;
  readonly runBash: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readonly runInteractive?: (nodeId: string, question: string) => Promise<string>;
  readonly onNodeComplete?: (result: NodeResult) => void;
}

export interface WorkflowRunResult {
  readonly workflow: string;
  readonly results: ReadonlyMap<string, NodeResult>;
  readonly success: boolean;
  readonly failedNodeId?: string;
  readonly durationMs: number;
}

// ── YAML parser ───────────────────────────────────────

export function parseWorkflow(yamlText: string): Workflow {
  const parsed = parseYaml(yamlText) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("workflow-runner: YAML root must be an object");
  }
  const root = parsed as {
    name?: unknown;
    description?: unknown;
    nodes?: unknown;
    version?: unknown;
  };
  if (typeof root.name !== "string" || !root.name.trim()) {
    throw new Error("workflow-runner: workflow.name is required");
  }
  if (!Array.isArray(root.nodes) || root.nodes.length === 0) {
    throw new Error("workflow-runner: workflow.nodes must be a non-empty array");
  }
  const nodes = root.nodes.map((n) => validateNode(n));
  const base: Workflow = {
    name: root.name,
    nodes,
  };
  const overrides: { description?: string; version?: string } = {};
  if (typeof root.description === "string") overrides.description = root.description;
  if (typeof root.version === "string") overrides.version = root.version;
  return { ...base, ...overrides };
}

function validateNode(raw: unknown, path: string = "nodes"): WorkflowNode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`workflow-runner: ${path} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !r["id"]) {
    throw new Error(`workflow-runner: ${path}.id is required`);
  }
  const validKinds: WorkflowNodeKind[] = [
    "prompt",
    "bash",
    "interactive",
    "loop-until",
    "parallel",
    "sequence",
  ];
  if (typeof r["kind"] !== "string" || !validKinds.includes(r["kind"] as WorkflowNodeKind)) {
    throw new Error(`workflow-runner: ${path}.kind must be one of: ${validKinds.join(", ")}`);
  }
  const node: WorkflowNode = {
    id: r["id"] as string,
    kind: r["kind"] as WorkflowNodeKind,
    ...(Array.isArray(r["depends_on"]) ? { depends_on: r["depends_on"] as readonly string[] } : {}),
    ...(typeof r["prompt"] === "string" ? { prompt: r["prompt"] } : {}),
    ...(typeof r["bash"] === "string" ? { bash: r["bash"] } : {}),
    ...(typeof r["interactive"] === "string" ? { interactive: r["interactive"] } : {}),
    ...(typeof r["condition"] === "string" ? { condition: r["condition"] } : {}),
    ...(typeof r["max_iterations"] === "number" ? { max_iterations: r["max_iterations"] } : {}),
    ...(Array.isArray(r["children"])
      ? {
          children: (r["children"] as unknown[]).map((c, i) =>
            validateNode(c, `${path}[${r["id"]}].children[${i}]`),
          ),
        }
      : {}),
    ...(typeof r["timeout_ms"] === "number" ? { timeout_ms: r["timeout_ms"] } : {}),
    ...(typeof r["continue_on_error"] === "boolean"
      ? { continue_on_error: r["continue_on_error"] }
      : {}),
  };
  return node;
}

// ── Topological sort ──────────────────────────────────

export function topoSort(nodes: readonly WorkflowNode[]): readonly WorkflowNode[] {
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) byId.set(n.id, n);

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    dependents.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.depends_on ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`workflow-runner: ${n.id} depends_on unknown node "${dep}"`);
      }
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      dependents.get(dep)?.push(n.id);
    }
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) queue.push(n.id);
  }
  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    sorted.push(node);
    for (const dep of dependents.get(id) ?? []) {
      const d = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, d);
      if (d === 0) queue.push(dep);
    }
  }
  if (sorted.length !== nodes.length) {
    throw new Error("workflow-runner: cycle detected in depends_on graph");
  }
  return sorted;
}

// ── Runner ─────────────────────────────────────────────

export async function runWorkflow(
  workflow: Workflow,
  executors: WorkflowExecutors,
): Promise<WorkflowRunResult> {
  const startedAt = Date.now();
  const results = new Map<string, NodeResult>();
  const state: Record<string, unknown> = {};
  let failedNodeId: string | undefined;

  const sortedNodes = topoSort(workflow.nodes);

  for (const node of sortedNodes) {
    try {
      const result = await executeNode(node, executors, { results, state });
      results.set(node.id, result);
      executors.onNodeComplete?.(result);
      if (result.error && !node.continue_on_error) {
        failedNodeId = node.id;
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.set(node.id, {
        nodeId: node.id,
        output: "",
        error: msg,
        durationMs: 0,
      });
      if (!node.continue_on_error) {
        failedNodeId = node.id;
        break;
      }
    }
  }

  return {
    workflow: workflow.name,
    results,
    success: failedNodeId === undefined,
    ...(failedNodeId !== undefined ? { failedNodeId } : {}),
    durationMs: Date.now() - startedAt,
  };
}

async function executeNode(
  node: WorkflowNode,
  executors: WorkflowExecutors,
  context: RunContext,
): Promise<NodeResult> {
  const startedAt = Date.now();

  switch (node.kind) {
    case "prompt": {
      if (!node.prompt) throw new Error(`prompt node ${node.id} missing "prompt" field`);
      const output = await executors.runPrompt(interpolate(node.prompt, context));
      return { nodeId: node.id, output, durationMs: Date.now() - startedAt };
    }

    case "bash": {
      if (!node.bash) throw new Error(`bash node ${node.id} missing "bash" field`);
      const r = await executors.runBash(interpolate(node.bash, context));
      const result: NodeResult = {
        nodeId: node.id,
        output: r.stdout,
        exitCode: r.exitCode,
        durationMs: Date.now() - startedAt,
        ...(r.exitCode !== 0 ? { error: r.stderr || `exit ${r.exitCode}` } : {}),
      };
      return result;
    }

    case "interactive": {
      if (!executors.runInteractive) {
        throw new Error(`interactive node ${node.id} requires runInteractive executor`);
      }
      const question = node.interactive ?? "";
      const output = await executors.runInteractive(node.id, interpolate(question, context));
      return { nodeId: node.id, output, durationMs: Date.now() - startedAt };
    }

    case "sequence": {
      const children = node.children ?? [];
      const outputs: string[] = [];
      for (const child of children) {
        const r = await executeNode(child, executors, context);
        outputs.push(`[${child.id}] ${r.output}`);
        if (r.error && !child.continue_on_error) {
          return {
            nodeId: node.id,
            output: outputs.join("\n"),
            error: `sequence failed at ${child.id}: ${r.error}`,
            durationMs: Date.now() - startedAt,
          };
        }
      }
      return { nodeId: node.id, output: outputs.join("\n"), durationMs: Date.now() - startedAt };
    }

    case "parallel": {
      const children = node.children ?? [];
      const results = await Promise.all(children.map((c) => executeNode(c, executors, context)));
      const outputs = results.map((r) => `[${r.nodeId}] ${r.output}`).join("\n");
      const firstError = results.find((r) => r.error);
      const base: NodeResult = {
        nodeId: node.id,
        output: outputs,
        durationMs: Date.now() - startedAt,
      };
      return firstError
        ? { ...base, error: `parallel: ${firstError.nodeId} failed: ${firstError.error}` }
        : base;
    }

    case "loop-until": {
      if (!node.condition) throw new Error(`loop-until node ${node.id} missing "condition" field`);
      const maxIter = node.max_iterations ?? 10;
      let iter = 0;
      const outputs: string[] = [];
      while (iter < maxIter) {
        iter++;
        const body = node.children ?? [];
        for (const child of body) {
          const r = await executeNode(child, executors, context);
          outputs.push(`[iter=${iter} ${child.id}] ${r.output}`);
        }
        const condResult = evaluateCondition(node.condition, context);
        if (condResult) break;
      }
      return {
        nodeId: node.id,
        output: outputs.join("\n"),
        iterations: iter,
        durationMs: Date.now() - startedAt,
        ...(iter >= maxIter
          ? { error: `loop-until did not converge within ${maxIter} iterations` }
          : {}),
      };
    }

    default: {
      const _exhaust: never = node.kind;
      throw new Error(`unhandled node kind: ${String(_exhaust)}`);
    }
  }
}

// ── Interpolation ─────────────────────────────────────

export function interpolate(template: string, context: RunContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const parts = (path as string).trim().split(".");
    const root = parts[0];
    if (root === "results" && parts.length >= 3) {
      const nodeId = parts[1];
      const field = parts[2];
      if (!nodeId || !field) return match;
      const r = context.results.get(nodeId);
      if (!r) return match;
      const key = field as keyof NodeResult;
      const val = r[key];
      return val === undefined ? match : String(val);
    }
    if (root === "state" && parts.length >= 2) {
      const key = parts[1];
      if (!key) return match;
      const val = context.state[key];
      return val === undefined ? match : String(val);
    }
    return match;
  });
}

// ── Condition matcher ────────────────────────────────

/**
 * Match a loop-until condition against the current context. Supports a
 * small set of explicit patterns — no dynamic code execution, so
 * untrusted YAML cannot escape the sandbox. Returns true when the
 * condition holds, false otherwise (including on parse failure).
 *
 * Supported forms:
 *   - "X == Y"                 — literal/value equality
 *   - "X contains 'Y'"         — substring match
 *   - "X exists"               — defined and non-null
 */
export function evaluateCondition(expr: string, context: RunContext): boolean {
  const trimmed = expr.trim();

  const eqMatch = trimmed.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    const left = resolveExprRef(eqMatch[1]!, context);
    const right = parseLiteral(eqMatch[2]!);
    return String(left) === String(right);
  }

  const containsMatch = trimmed.match(/^(.+?)\s+contains\s+['"]([^'"]+)['"]$/);
  if (containsMatch) {
    const left = resolveExprRef(containsMatch[1]!, context);
    return typeof left === "string" && left.includes(containsMatch[2]!);
  }

  const existsMatch = trimmed.match(/^(.+?)\s+exists$/);
  if (existsMatch) {
    const v = resolveExprRef(existsMatch[1]!, context);
    return v !== undefined && v !== null;
  }

  return false;
}

function resolveExprRef(ref: string, context: RunContext): unknown {
  const parts = ref.trim().split(".");
  const root = parts[0];
  if (root === "results" && parts.length >= 3) {
    const r = context.results.get(parts[1]!);
    if (!r) return undefined;
    return (r as unknown as Record<string, unknown>)[parts[2]!];
  }
  if (root === "state" && parts.length >= 2) {
    return context.state[parts[1]!];
  }
  return undefined;
}

function parseLiteral(s: string): unknown {
  const t = s.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
