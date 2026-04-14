/**
 * Agent Protocol Standard — AI Engineer Foundation compliance.
 * Standardized agent communication for interoperability.
 * Enables WOTANN agents to communicate with agents from other frameworks.
 */

// ── Types (based on AI Engineer Foundation Agent Protocol) ────

export interface AgentProtocolTask {
  readonly task_id: string;
  readonly input: string;
  readonly additional_input?: Record<string, unknown>;
  readonly created_at: string;
  readonly modified_at: string;
}

export interface AgentProtocolStep {
  readonly step_id: string;
  readonly task_id: string;
  readonly name: string;
  readonly status: "created" | "running" | "completed" | "failed";
  readonly input: string;
  readonly output: string;
  readonly additional_output?: Record<string, unknown>;
  readonly is_last: boolean;
  readonly created_at: string;
  readonly modified_at: string;
}

export interface AgentProtocolArtifact {
  readonly artifact_id: string;
  readonly file_name: string;
  readonly relative_path: string;
  readonly created_at: string;
}

export interface AgentCapabilities {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly protocol_version: string;
}

// ── Protocol Handler ─────────────────────────────────────

export class AgentProtocolHandler {
  private readonly tasks: Map<string, AgentProtocolTask> = new Map();
  private readonly steps: Map<string, AgentProtocolStep[]> = new Map();
  private readonly artifacts: Map<string, AgentProtocolArtifact[]> = new Map();

  /**
   * Get agent capabilities (GET /agent/capabilities)
   */
  getCapabilities(): AgentCapabilities {
    return {
      name: "WOTANN",
      version: "0.1.0",
      capabilities: [
        "code-generation",
        "code-review",
        "bug-fix",
        "testing",
        "research",
        "multi-model",
        "memory",
        "autonomous",
      ],
      protocol_version: "1.0",
    };
  }

  /**
   * Create a task (POST /agent/tasks)
   */
  createTask(input: string, additionalInput?: Record<string, unknown>): AgentProtocolTask {
    const now = new Date().toISOString();
    const task: AgentProtocolTask = {
      task_id: `task-${Date.now()}`,
      input,
      additional_input: additionalInput,
      created_at: now,
      modified_at: now,
    };
    this.tasks.set(task.task_id, task);
    this.steps.set(task.task_id, []);
    this.artifacts.set(task.task_id, []);
    return task;
  }

  /**
   * List tasks (GET /agent/tasks)
   */
  listTasks(): readonly AgentProtocolTask[] {
    return [...this.tasks.values()];
  }

  /**
   * Get a task (GET /agent/tasks/{task_id})
   */
  getTask(taskId: string): AgentProtocolTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * Execute a step (POST /agent/tasks/{task_id}/steps)
   */
  executeStep(taskId: string, input: string): AgentProtocolStep {
    const steps = this.steps.get(taskId) ?? [];
    const now = new Date().toISOString();
    const step: AgentProtocolStep = {
      step_id: `step-${Date.now()}`,
      task_id: taskId,
      name: `Step ${steps.length + 1}`,
      status: "completed",
      input,
      output: "",
      is_last: false,
      created_at: now,
      modified_at: now,
    };
    steps.push(step);
    this.steps.set(taskId, steps);
    return step;
  }

  /**
   * List steps (GET /agent/tasks/{task_id}/steps)
   */
  listSteps(taskId: string): readonly AgentProtocolStep[] {
    return this.steps.get(taskId) ?? [];
  }

  /**
   * Add artifact (POST /agent/tasks/{task_id}/artifacts)
   */
  addArtifact(taskId: string, fileName: string, relativePath: string): AgentProtocolArtifact {
    const artifacts = this.artifacts.get(taskId) ?? [];
    const artifact: AgentProtocolArtifact = {
      artifact_id: `artifact-${Date.now()}`,
      file_name: fileName,
      relative_path: relativePath,
      created_at: new Date().toISOString(),
    };
    artifacts.push(artifact);
    this.artifacts.set(taskId, artifacts);
    return artifact;
  }

  /**
   * List artifacts (GET /agent/tasks/{task_id}/artifacts)
   */
  listArtifacts(taskId: string): readonly AgentProtocolArtifact[] {
    return this.artifacts.get(taskId) ?? [];
  }
}
