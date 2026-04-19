/**
 * Skill compositor — chain skills by output→input matching.
 *
 * Individual skills handle one transformation (e.g. "URL → HTML",
 * "HTML → markdown", "markdown → bullet summary"). Composing them
 * manually works for the first task but becomes a maintenance
 * burden. The compositor takes a goal type + input type + skill
 * registry and finds the shortest chain that connects them.
 *
 * Approach: type-graph BFS.
 *   - Each skill is an edge: inputType → outputType
 *   - Node = type
 *   - Shortest path from sourceType to goalType = skill chain
 *
 * Ships:
 *   - SkillDescriptor (input/output type + execute fn)
 *   - findSkillChain(source, goal, skills): the shortest chain
 *   - executeChain(input, chain): runs the chain
 *   - registerSkill / unregisterSkill helpers on a SkillCompositor class
 *
 * Pure graph ops; execute is async. Works with string type labels
 * (e.g. "url", "html", "markdown", "summary").
 */

// ── Types ──────────────────────────────────────────────

export interface SkillDescriptor {
  readonly name: string;
  readonly inputType: string;
  readonly outputType: string;
  readonly execute: (input: unknown) => Promise<unknown>;
  /** Cost estimate (higher = more expensive). Used for tie-breaking. Default 1. */
  readonly cost?: number;
  /** Optional description for debugging. */
  readonly description?: string;
}

export interface SkillChain {
  readonly source: string;
  readonly goal: string;
  readonly skills: readonly SkillDescriptor[];
  readonly totalCost: number;
}

export interface ExecutionResult {
  readonly output: unknown;
  readonly intermediateOutputs: readonly unknown[];
  readonly skillsExecuted: readonly string[];
  readonly durationMs: number;
}

// ── BFS pathfinding ───────────────────────────────────

/**
 * Find the shortest skill chain that transforms `source` type into
 * `goal` type. Returns null when no chain exists.
 */
export function findSkillChain(
  source: string,
  goal: string,
  skills: readonly SkillDescriptor[],
): SkillChain | null {
  if (source === goal) {
    return { source, goal, skills: [], totalCost: 0 };
  }

  // Adjacency map: type → (skill → nextType)
  const byInput = new Map<string, SkillDescriptor[]>();
  for (const skill of skills) {
    const existing = byInput.get(skill.inputType) ?? [];
    existing.push(skill);
    byInput.set(skill.inputType, existing);
  }

  // BFS
  type Node = { type: string; chain: SkillDescriptor[]; cost: number };
  const queue: Node[] = [{ type: source, chain: [], cost: 0 }];
  const visited = new Set<string>([source]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = byInput.get(current.type) ?? [];
    // Sort edges by cost ascending so cheaper paths are explored first
    const sorted = [...edges].sort((a, b) => (a.cost ?? 1) - (b.cost ?? 1));
    for (const edge of sorted) {
      const nextType = edge.outputType;
      const newChain = [...current.chain, edge];
      const newCost = current.cost + (edge.cost ?? 1);
      if (nextType === goal) {
        return { source, goal, skills: newChain, totalCost: newCost };
      }
      if (!visited.has(nextType)) {
        visited.add(nextType);
        queue.push({ type: nextType, chain: newChain, cost: newCost });
      }
    }
  }

  return null;
}

// ── Execution ────────────────────────────────────────

export async function executeChain(input: unknown, chain: SkillChain): Promise<ExecutionResult> {
  const startedAt = Date.now();
  const intermediates: unknown[] = [];
  const names: string[] = [];
  let current = input;
  for (const skill of chain.skills) {
    current = await skill.execute(current);
    intermediates.push(current);
    names.push(skill.name);
  }
  return {
    output: current,
    intermediateOutputs: intermediates,
    skillsExecuted: names,
    durationMs: Date.now() - startedAt,
  };
}

// ── Compositor class ─────────────────────────────────

export class SkillCompositor {
  private skills: Map<string, SkillDescriptor> = new Map();

  register(skill: SkillDescriptor): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`SkillCompositor: skill "${skill.name}" already registered`);
    }
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  list(): readonly SkillDescriptor[] {
    return [...this.skills.values()];
  }

  size(): number {
    return this.skills.size;
  }

  findChain(source: string, goal: string): SkillChain | null {
    return findSkillChain(source, goal, [...this.skills.values()]);
  }

  async compose(input: unknown, source: string, goal: string): Promise<ExecutionResult | null> {
    const chain = this.findChain(source, goal);
    if (!chain) return null;
    return executeChain(input, chain);
  }

  /**
   * Find ALL chains up to maxDepth (enumeration, not just shortest).
   * Useful for surfacing alternatives when the shortest is broken.
   */
  findAllChains(source: string, goal: string, maxDepth: number = 5): readonly SkillChain[] {
    const skillList = [...this.skills.values()];
    const chains: SkillChain[] = [];

    const byInput = new Map<string, SkillDescriptor[]>();
    for (const skill of skillList) {
      const existing = byInput.get(skill.inputType) ?? [];
      existing.push(skill);
      byInput.set(skill.inputType, existing);
    }

    function dfs(type: string, chain: SkillDescriptor[], visited: Set<string>, cost: number): void {
      if (type === goal) {
        chains.push({ source, goal, skills: [...chain], totalCost: cost });
        return;
      }
      if (chain.length >= maxDepth) return;
      const edges = byInput.get(type) ?? [];
      for (const edge of edges) {
        if (visited.has(edge.outputType)) continue;
        visited.add(edge.outputType);
        chain.push(edge);
        dfs(edge.outputType, chain, visited, cost + (edge.cost ?? 1));
        chain.pop();
        visited.delete(edge.outputType);
      }
    }

    dfs(source, [], new Set([source]), 0);
    chains.sort((a, b) => a.totalCost - b.totalCost);
    return chains;
  }
}
