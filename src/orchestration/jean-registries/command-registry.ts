/**
 * CommandRegistry — Jean §2.4 port (WOTANN P1-C9).
 *
 * Jean (coollabsio/jean) multiplexes 4 different CLIs through one common
 * interface backed by four process registries. This file implements the
 * first of those registries — the command policy registry — ported from
 * the Rust `src-tauri/src/chat/registry.rs` design described in
 * `docs/internal/RESEARCH_CONDUCTOR_JEAN_ZED_PLUS.md` §2.4.
 *
 * Purpose: keep an explicit allow-list of commands, each with a bounded
 * policy (timeout, retry, concurrency cap, argument schema). Nothing runs
 * without an entry here — this is the gate JeanOrchestrator queries
 * before touching child_process.
 *
 * DESIGN NOTES:
 * - Per-instance state only (`private readonly policies = new Map<...>`).
 *   Quality Bar #7: no module-global cross-session contamination.
 * - Records are frozen before handing them out; callers get immutable
 *   snapshots, mutations require going back through `register()`.
 * - Validation is honest: empty names, non-positive timeouts, and
 *   negative concurrency caps throw `CommandRegistryError` rather than
 *   silently coercing. Quality Bar (session-2 #2): honest stubs over
 *   silent success.
 */

// ── Types ────────────────────────────────────────────────────────

/**
 * Schema describing the shape of allowed arguments for a command.
 * Kept intentionally simple — the registry validates structural
 * constraints (count, flag whitelist). Deeper per-argument validation
 * can be layered on top in JeanOrchestrator callers.
 */
export interface ArgsSchema {
  /** Max positional+flag args accepted. */
  readonly maxArgs?: number;
  /** If set, any arg starting with "-" must be in this list. */
  readonly allowedFlags?: readonly string[];
}

export interface CommandPolicy {
  /** Canonical command name used to look up the policy. */
  readonly name: string;
  /** Absolute path to the binary (execFile, no shell). */
  readonly binary: string;
  /** Argument-shape constraints. */
  readonly argsSchema: ArgsSchema;
  /** Hard per-invocation timeout. Must be > 0. */
  readonly timeoutMs: number;
  /** Number of retries on spawn failure. Must be >= 0. */
  readonly retry: number;
  /** Maximum concurrent in-flight processes for this command. Must be >= 0 (0 = unlimited). */
  readonly concurrencyCap: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

// ── Registry ─────────────────────────────────────────────────────

export class CommandRegistry {
  // Per-instance state (Quality Bar #7).
  private readonly policies = new Map<string, CommandPolicy>();

  /**
   * Register a new command policy. Throws CommandRegistryError on
   * duplicate name, bad timeout, or bad concurrency cap.
   */
  register(policy: CommandPolicy): CommandPolicy {
    if (!policy.name || policy.name.trim().length === 0) {
      throw new CommandRegistryError("Command name must be non-empty");
    }
    if (!policy.binary || policy.binary.trim().length === 0) {
      throw new CommandRegistryError(`Command "${policy.name}" missing binary path`);
    }
    if (!Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) {
      throw new CommandRegistryError(
        `Command "${policy.name}" timeout must be > 0 (got ${policy.timeoutMs})`,
      );
    }
    if (!Number.isFinite(policy.retry) || policy.retry < 0) {
      throw new CommandRegistryError(
        `Command "${policy.name}" retry must be >= 0 (got ${policy.retry})`,
      );
    }
    if (!Number.isFinite(policy.concurrencyCap) || policy.concurrencyCap < 0) {
      throw new CommandRegistryError(
        `Command "${policy.name}" concurrency cap must be >= 0 (got ${policy.concurrencyCap})`,
      );
    }
    if (this.policies.has(policy.name)) {
      throw new CommandRegistryError(`Command "${policy.name}" already registered`);
    }

    const frozen: CommandPolicy = Object.freeze({
      name: policy.name,
      binary: policy.binary,
      argsSchema: Object.freeze({ ...policy.argsSchema }),
      timeoutMs: policy.timeoutMs,
      retry: policy.retry,
      concurrencyCap: policy.concurrencyCap,
    });
    this.policies.set(policy.name, frozen);
    return frozen;
  }

  /**
   * Return the stored policy (immutable) for `name`, or undefined.
   */
  get(name: string): CommandPolicy | undefined {
    return this.policies.get(name);
  }

  /**
   * Quick membership check.
   */
  has(name: string): boolean {
    return this.policies.has(name);
  }

  /**
   * All registered policies (stable snapshot; mutating the returned
   * array does not mutate the registry).
   */
  list(): readonly CommandPolicy[] {
    return [...this.policies.values()];
  }

  /**
   * Validate args against the registered policy. Returns a structured
   * result instead of throwing — callers (the orchestrator) decide
   * whether to promote this to an error.
   */
  validateArgs(name: string, args: readonly string[]): ValidationResult {
    const policy = this.policies.get(name);
    if (!policy) {
      return { valid: false, reason: `unknown command "${name}"` };
    }
    const { argsSchema } = policy;

    if (argsSchema.maxArgs !== undefined && args.length > argsSchema.maxArgs) {
      return {
        valid: false,
        reason: `too many args for "${name}": ${args.length} > max ${argsSchema.maxArgs}`,
      };
    }

    if (argsSchema.allowedFlags !== undefined) {
      const allowed = new Set(argsSchema.allowedFlags);
      for (const arg of args) {
        if (arg.startsWith("-") && !allowed.has(arg)) {
          return {
            valid: false,
            reason: `disallowed flag "${arg}" for "${name}"`,
          };
        }
      }
    }

    return { valid: true };
  }
}

// ── Error Type ───────────────────────────────────────────────────

export class CommandRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandRegistryError";
  }
}
