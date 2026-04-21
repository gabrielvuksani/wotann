/**
 * TodoProvider — injectable adapter that feeds GoalDriftDetector a
 * `TodoState` snapshot during runtime wiring (P1-B7 part 3).
 *
 * Why an interface? The GoalDriftDetector is provider-agnostic: the
 * autonomous loop only needs "give me the current todos for this
 * task" and "persist any updates". How that's backed (an in-memory
 * map in tests, the FS-backed `.wotann/todos/<taskId>.md` the
 * `TodoTracker` writes in prod, a remote service for a daemon) is a
 * caller decision. Keeping this a small interface lets tests inject
 * a deterministic mock and lets the runtime default to a zero-cost
 * no-op until the user explicitly opts in.
 *
 * Design notes (WOTANN quality bars):
 * - QB #1 immutability: every `TodoState` returned is a fresh
 *   snapshot; providers never hand out their internal arrays.
 * - QB #6 honest failures: `NullTodoProvider` returns empty state
 *   with a clear `taskId` so a mis-wired caller can see their call
 *   landed on the no-op, not silently returned "no drift".
 * - QB #7 per-session state: `createFsTodoProvider` scopes by
 *   `rootDir`, never by module global. Two providers pointed at
 *   different working dirs stay isolated.
 * - QB #14 real wiring: there is NO default FS provider. Callers
 *   must EITHER inject `NullTodoProvider` (opt-out) or build one
 *   via `createFsTodoProvider`. No hidden global state.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

import {
  TodoTracker,
  renderTodoMd,
  type TodoState,
  type Subgoal,
  type ScopeChange,
} from "./todo-tracker.js";

// Public interface ------------------------------------------

/**
 * Adapter between the runtime (which knows a `taskId`) and the
 * underlying storage for that task's todo.md. Implementations must
 * never mutate the state they return — callers receive snapshots.
 */
export interface TodoProvider {
  /**
   * Return the todo state for `taskId`. If the task has no todo yet,
   * return an empty snapshot with `taskId` set (never throw — an
   * unknown task is a valid "no todos yet" state).
   */
  readTodo(taskId: string): Promise<TodoState>;
  /**
   * Persist a new state snapshot. Providers that don't persist
   * (e.g. `NullTodoProvider`) should accept the call silently; the
   * caller doesn't care whether it hit disk.
   */
  writeTodo(taskId: string, state: TodoState): Promise<void>;
}

// NullTodoProvider ------------------------------------------

/**
 * Default provider used when `getGoalDriftDetector()` is invoked
 * without a real provider configured. Always returns an empty state
 * so the detector's "no pending todos — nothing to drift from"
 * branch fires. Writes are accepted and discarded.
 *
 * This is the honest-stub per QB #6: a mis-wired caller will see
 * "method: heuristic, drift: false, reason: no pending todos" in
 * logs — not silently swallow a real drift condition.
 */
export const NullTodoProvider: TodoProvider = {
  async readTodo(taskId: string): Promise<TodoState> {
    const now = new Date().toISOString();
    return Object.freeze({
      taskId,
      taskSpec: "",
      done: Object.freeze([] as readonly Subgoal[]),
      pending: Object.freeze([] as readonly Subgoal[]),
      scopeChanges: Object.freeze([] as readonly ScopeChange[]),
      createdAt: now,
      updatedAt: now,
    });
  },
  async writeTodo(_taskId: string, _state: TodoState): Promise<void> {
    // Intentional no-op — see class docstring.
    return;
  },
};

// FS-backed provider ----------------------------------------

export interface FsTodoProviderOptions {
  /** Root dir (e.g. session working dir). Defaults to `process.cwd()`. */
  readonly rootDir?: string;
  /** Override for the todos subdir. Defaults to `.wotann/todos`. */
  readonly todosDir?: string;
}

/**
 * Construct a provider that reads/writes `<rootDir>/.wotann/todos/<taskId>.md`
 * using the same markdown schema `TodoTracker` writes. Safe to share
 * across concurrent tasks: each `taskId` maps to its own file, and
 * there is no in-memory cache that could cross-contaminate.
 *
 * Unknown-task reads return an empty snapshot (not an error) — the
 * detector treats an empty todo list as "nothing to drift from".
 */
export function createFsTodoProvider(options: FsTodoProviderOptions = {}): TodoProvider {
  const rootDir = options.rootDir ?? process.cwd();
  const todosDir = options.todosDir ?? join(rootDir, ".wotann", "todos");

  function pathFor(taskId: string): string {
    return join(todosDir, `${sanitize(taskId)}.md`);
  }

  return {
    async readTodo(taskId: string): Promise<TodoState> {
      const file = pathFor(taskId);
      if (!existsSync(file)) {
        return NullTodoProvider.readTodo(taskId);
      }
      // Delegate markdown parsing to TodoTracker so the wire format
      // stays single-source-of-truth.
      const tracker = TodoTracker.load(taskId, {
        workingDir: rootDir,
        todosDir,
        persist: false,
      });
      return tracker.state();
    },
    async writeTodo(taskId: string, state: TodoState): Promise<void> {
      const file = pathFor(taskId);
      const dir = dirname(file);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(file, renderTodoMd(state), "utf-8");
    },
  };
}

// Helpers ---------------------------------------------------

function sanitize(taskId: string): string {
  // Keep file name filesystem-safe on all platforms — mirror the
  // sanitizer in todo-tracker.ts so paths resolve identically.
  return taskId.replace(/[^A-Za-z0-9._-]/g, "_");
}

// Public helper for callers that want a one-shot read without
// building a provider. Consumes one `readTodo` via the supplied
// provider and returns the snapshot. Kept tiny and explicit rather
// than hiding it inside a closure — easier to grep, easier to stub.
export async function snapshotTodos(provider: TodoProvider, taskId: string): Promise<TodoState> {
  return provider.readTodo(taskId);
}

/**
 * Utility: recognize whether a provider is the null stub.
 *
 * Callers that want to short-circuit drift checks when no real
 * provider is attached can gate on this. Example:
 *
 *   if (provider === NullTodoProvider) return; // skip drift
 *
 * Comparing by reference is safe because `NullTodoProvider` is a
 * module-level singleton; we never duplicate it.
 */
export function isNullTodoProvider(provider: TodoProvider): boolean {
  return provider === NullTodoProvider;
}

// Re-export TodoState for callers that only depend on todo-provider.
export type { TodoState };

/**
 * Helper: read raw markdown via the FS provider without going
 * through the tracker. Useful in tests for asserting a round-trip.
 */
export function readTodoMdRaw(rootDir: string, taskId: string, todosDir?: string): string | null {
  const dir = todosDir ?? join(rootDir, ".wotann", "todos");
  const file = join(dir, `${sanitize(taskId)}.md`);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}
