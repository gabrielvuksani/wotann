/**
 * unified_exec — Codex parity, PTY-less shell session (Phase 5A).
 *
 * Codex ships a unified_exec tool that carries shell state (env, cwd,
 * history) between tool calls so the agent can run a sequence like
 * "cd src/" then "ls" and have the second command run inside src/.
 *
 * Fire-and-forget execution (src/sandbox/executor.ts) has no shared
 * state — every call starts from scratch. That's correct for
 * untrusted sandboxed calls but breaks natural agent workflows.
 *
 * This module ships a PTY-less session: a stateful wrapper that
 * tracks cwd, env, and history, resolves built-ins (cd/export/unset/
 * pwd/env) in-process without spawning a shell, and spawns /bin/sh -c
 * for everything else WITH the tracked env + cwd forwarded.
 *
 * Phase-D extension: `shellSnapshot()` / `fromSnapshot()` /
 * `serializeShellSnapshot` capture + rehydrate state across sessions
 * so a crashed or timed-out session can resume at its last cwd/env.
 *
 * Security posture: this module is NOT a sandbox boundary. Callers
 * responsible for untrusted code should wrap this with
 * src/sandbox/executor.ts + a seatbelt profile. This module uses
 * spawn() with argv passed as ["-c", command] so the caller's
 * command-string ARE interpreted by the shell — that's the whole
 * point of unified_exec, to allow pipes, globs, and redirects like
 * a normal interactive shell session.
 */

import { spawn } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { existsSync, statSync } from "node:fs";

// ── Types ──────────────────────────────────────────────

export interface UnifiedExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly shell?: string;
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  readonly maxHistory?: number;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly command: string;
  readonly cwdAfter: string;
}

export interface SessionSnapshot {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly history: ReadonlyArray<{
    readonly command: string;
    readonly exitCode: number;
    readonly ranAt: number;
  }>;
}

/**
 * Codex `shell_snapshot` parity — same shape as SessionSnapshot, plus a
 * version tag so serialised snapshots can be migrated when the shape
 * changes. Callers writing snapshots to disk should prefer this over
 * plain SessionSnapshot.
 */
export interface ShellSnapshot extends SessionSnapshot {
  /**
   * Snapshot schema version. v1 = cwd + env + history only. Bumped when
   * we add fields (e.g. aliases, shell-options).
   */
  readonly version: 1;
  /** Unix ms when this snapshot was captured — for stale-snapshot warnings. */
  readonly capturedAt: number;
}

export const SHELL_SNAPSHOT_VERSION = 1 as const;

// ── Parser ─────────────────────────────────────────────

type BuiltinKind = "cd" | "pwd" | "export" | "unset" | "env";

interface ParsedBuiltin {
  readonly kind: BuiltinKind;
  readonly args: readonly string[];
}

export function parseBuiltin(command: string): ParsedBuiltin | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(cd|pwd|export|unset|env)(\s+(.*))?$/);
  if (!match) return null;
  const kind = match[1] as BuiltinKind;
  const rest = (match[3] ?? "").trim();
  if (!rest) return { kind, args: [] };
  return { kind, args: splitArgs(rest) };
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        buf += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === " " || c === "\t") {
      if (buf) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += c;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ── Session ────────────────────────────────────────────

export class UnifiedExecSession {
  private currentCwd: string;
  private currentEnv: Record<string, string>;
  private history: Array<{ command: string; exitCode: number; ranAt: number }> = [];
  private readonly shell: string;
  private readonly timeoutMs: number;
  private readonly maxBuffer: number;
  private readonly maxHistory: number;

  constructor(options: UnifiedExecOptions = {}) {
    this.currentCwd = resolve(options.cwd ?? process.cwd());
    this.currentEnv = { ...(options.env ?? (process.env as Record<string, string>)) };
    this.shell = options.shell ?? "/bin/sh";
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    this.maxHistory = options.maxHistory ?? 200;
  }

  get cwd(): string {
    return this.currentCwd;
  }

  get env(): Readonly<Record<string, string>> {
    return this.currentEnv;
  }

  snapshot(): SessionSnapshot {
    return {
      cwd: this.currentCwd,
      env: { ...this.currentEnv },
      history: [...this.history],
    };
  }

  restore(snapshot: SessionSnapshot | ShellSnapshot): void {
    this.currentCwd = snapshot.cwd;
    this.currentEnv = { ...snapshot.env };
    this.history = [...snapshot.history];
  }

  /**
   * Codex `shell_snapshot` — capture cwd, env, and the last N commands
   * with a schema version for cross-version migration. Callers that
   * want to serialize to disk or hand the state across to a fresh
   * session should prefer this over plain `snapshot()`.
   */
  shellSnapshot(): ShellSnapshot {
    return {
      version: SHELL_SNAPSHOT_VERSION,
      capturedAt: Date.now(),
      cwd: this.currentCwd,
      env: { ...this.currentEnv },
      history: [...this.history],
    };
  }

  /**
   * Build a fresh session pre-loaded with a snapshot's state. Useful
   * when a prior session has ended (timeout, crash, intentional
   * shutdown) and the caller wants to resume from its last known
   * position — the equivalent of Codex's "attach to snapshot" flow.
   */
  static fromSnapshot(
    snapshot: SessionSnapshot | ShellSnapshot,
    options: UnifiedExecOptions = {},
  ): UnifiedExecSession {
    const session = new UnifiedExecSession({
      ...options,
      cwd: snapshot.cwd,
      env: { ...snapshot.env },
    });
    session.restore(snapshot);
    return session;
  }

  async run(command: string): Promise<ExecResult> {
    const startedAt = Date.now();
    const trimmed = command.trim();
    if (!trimmed) {
      return this.record({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
        command: trimmed,
        cwdAfter: this.currentCwd,
      });
    }

    const builtin = parseBuiltin(trimmed);
    if (builtin) {
      return this.record(this.runBuiltin(builtin, trimmed, startedAt));
    }

    const inlineEnv = extractInlineEnv(trimmed);
    if (inlineEnv) {
      for (const [k, v] of Object.entries(inlineEnv.vars)) {
        this.currentEnv[k] = v;
      }
      if (!inlineEnv.remainder) {
        return this.record({
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: Date.now() - startedAt,
          command: trimmed,
          cwdAfter: this.currentCwd,
        });
      }
      return this.runShell(inlineEnv.remainder, startedAt, trimmed);
    }

    return this.runShell(trimmed, startedAt, trimmed);
  }

  private runBuiltin(builtin: ParsedBuiltin, rawCommand: string, startedAt: number): ExecResult {
    const base = {
      durationMs: Date.now() - startedAt,
      command: rawCommand,
      cwdAfter: this.currentCwd,
    };
    switch (builtin.kind) {
      case "cd": {
        const target = builtin.args[0] ?? this.currentEnv["HOME"] ?? this.currentCwd;
        const abs = isAbsolute(target) ? target : resolve(this.currentCwd, target);
        if (!existsSync(abs) || !statSync(abs).isDirectory()) {
          return {
            ...base,
            stdout: "",
            stderr: `cd: ${target}: No such file or directory`,
            exitCode: 1,
          };
        }
        this.currentCwd = abs;
        this.currentEnv["PWD"] = abs;
        return { ...base, cwdAfter: abs, stdout: "", stderr: "", exitCode: 0 };
      }
      case "pwd":
        return { ...base, stdout: `${this.currentCwd}\n`, stderr: "", exitCode: 0 };
      case "export": {
        for (const arg of builtin.args) {
          const eq = arg.indexOf("=");
          if (eq > 0) {
            this.currentEnv[arg.slice(0, eq)] = arg.slice(eq + 1);
          }
        }
        return { ...base, stdout: "", stderr: "", exitCode: 0 };
      }
      case "unset": {
        for (const key of builtin.args) delete this.currentEnv[key];
        return { ...base, stdout: "", stderr: "", exitCode: 0 };
      }
      case "env": {
        const lines = Object.entries(this.currentEnv)
          .map(([k, v]) => `${k}=${v}`)
          .sort();
        return { ...base, stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
      }
      default: {
        const _exhaust: never = builtin.kind;
        throw new Error(`unhandled builtin ${String(_exhaust)}`);
      }
    }
  }

  private runShell(
    cmdToRun: string,
    startedAt: number,
    originalCommand: string,
  ): Promise<ExecResult> {
    return new Promise((resolvePromise) => {
      const child = spawn(this.shell, ["-c", cmdToRun], {
        cwd: this.currentCwd,
        env: this.currentEnv,
      });
      let stdout = "";
      let stderr = "";
      let killedByTimeout = false;
      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < this.maxBuffer) stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < this.maxBuffer) stderr += chunk.toString();
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const exitCode = killedByTimeout ? -2 : typeof code === "number" ? code : signal ? -1 : 0;
        resolvePromise(
          this.record({
            stdout,
            stderr: killedByTimeout ? `${stderr}\nKilled by timeout (${this.timeoutMs}ms)` : stderr,
            exitCode,
            durationMs: Date.now() - startedAt,
            command: originalCommand,
            cwdAfter: this.currentCwd,
          }),
        );
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise(
          this.record({
            stdout,
            stderr: stderr + (err as Error).message,
            exitCode: -1,
            durationMs: Date.now() - startedAt,
            command: originalCommand,
            cwdAfter: this.currentCwd,
          }),
        );
      });
    });
  }

  private record(result: ExecResult): ExecResult {
    this.history.push({
      command: result.command,
      exitCode: result.exitCode,
      ranAt: Date.now(),
    });
    while (this.history.length > this.maxHistory) this.history.shift();
    return result;
  }
}

// ── Helpers ────────────────────────────────────────────

export function extractInlineEnv(
  command: string,
): { readonly vars: Record<string, string>; readonly remainder: string } | null {
  const vars: Record<string, string> = {};
  let rest = command;
  while (true) {
    const match = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)=(\S+)\s+(.*)$/);
    if (!match) break;
    vars[match[1]!] = match[2]!;
    rest = match[3]!;
  }
  if (Object.keys(vars).length === 0) return null;
  return { vars, remainder: rest };
}

// ── Shell-snapshot serialization ───────────────────────

/**
 * Serialize a snapshot to a JSON string safe to persist on disk.
 * Tolerates both SessionSnapshot and the richer ShellSnapshot; the
 * output is always the versioned ShellSnapshot shape so deserializers
 * can safely branch on `version`.
 */
export function serializeShellSnapshot(snapshot: SessionSnapshot | ShellSnapshot): string {
  const shell: ShellSnapshot = isShellSnapshot(snapshot)
    ? snapshot
    : {
        version: SHELL_SNAPSHOT_VERSION,
        capturedAt: Date.now(),
        cwd: snapshot.cwd,
        env: { ...snapshot.env },
        history: [...snapshot.history],
      };
  return JSON.stringify(shell);
}

/**
 * Parse a serialized shell snapshot. Throws on malformed input; returns
 * a strongly-typed ShellSnapshot on success. Unknown/newer versions
 * throw so callers can surface a migration prompt instead of silently
 * loading bad state.
 */
export function deserializeShellSnapshot(json: string): ShellSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`deserializeShellSnapshot: invalid JSON (${(err as Error).message})`);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("deserializeShellSnapshot: expected an object");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj["version"];
  if (version !== SHELL_SNAPSHOT_VERSION) {
    throw new Error(
      `deserializeShellSnapshot: unsupported version ${String(version)} (expected ${SHELL_SNAPSHOT_VERSION})`,
    );
  }
  const cwd = obj["cwd"];
  const env = obj["env"];
  const history = obj["history"];
  const capturedAt = obj["capturedAt"];
  if (typeof cwd !== "string") throw new Error("deserializeShellSnapshot: missing cwd");
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("deserializeShellSnapshot: env must be an object");
  }
  if (!Array.isArray(history)) {
    throw new Error("deserializeShellSnapshot: history must be an array");
  }
  if (typeof capturedAt !== "number") {
    throw new Error("deserializeShellSnapshot: missing capturedAt");
  }
  // Validate history entries; reject anything malformed so a corrupt
  // snapshot file doesn't silently load partial state.
  const safeHistory = history.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`deserializeShellSnapshot: history[${idx}] not an object`);
    }
    const h = entry as Record<string, unknown>;
    if (typeof h["command"] !== "string") {
      throw new Error(`deserializeShellSnapshot: history[${idx}].command must be a string`);
    }
    if (typeof h["exitCode"] !== "number") {
      throw new Error(`deserializeShellSnapshot: history[${idx}].exitCode must be a number`);
    }
    if (typeof h["ranAt"] !== "number") {
      throw new Error(`deserializeShellSnapshot: history[${idx}].ranAt must be a number`);
    }
    return {
      command: h["command"] as string,
      exitCode: h["exitCode"] as number,
      ranAt: h["ranAt"] as number,
    };
  });
  // env values should all be strings; drop non-string entries defensively.
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === "string") safeEnv[k] = v;
  }
  return {
    version: SHELL_SNAPSHOT_VERSION,
    capturedAt,
    cwd,
    env: safeEnv,
    history: safeHistory,
  };
}

function isShellSnapshot(x: SessionSnapshot | ShellSnapshot): x is ShellSnapshot {
  return typeof (x as ShellSnapshot).version === "number";
}
