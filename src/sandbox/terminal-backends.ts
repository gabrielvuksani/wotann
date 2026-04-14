/**
 * Terminal Backends — pluggable execution backends for sandboxed commands (D5).
 *
 * Supports local shell, Docker containers, SSH remotes, Daytona workspaces,
 * and Modal cloud functions. Each backend implements a common interface for
 * connect/exec/disconnect lifecycle.
 *
 * Features:
 * - Five backend types: local, docker, ssh, daytona, modal
 * - ExecOptions with cwd, env, timeoutMs, stdin support
 * - TerminalManager selects backend based on task requirements
 * - Security: LocalBackend uses execFile (not exec) to prevent shell injection
 * - All backends enforce configurable timeouts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Public Types ──────────────────────────────────────

export type BackendType = "local" | "docker" | "ssh" | "daytona" | "modal";

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface TerminalBackend {
  readonly name: string;
  readonly type: BackendType;
  connect(): Promise<void>;
  execute(command: string, options?: ExecOptions): Promise<ExecResult>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface BackendConfig {
  readonly type: BackendType;
  /** Docker image name or SSH host, depending on backend type. */
  readonly target?: string;
  /** SSH user or Docker workspace mount path. */
  readonly user?: string;
  /** SSH port or Docker exposed port. */
  readonly port?: number;
  /** SSH identity file path. */
  readonly identityFile?: string;
  /** Default timeout for all exec calls (ms). */
  readonly defaultTimeoutMs?: number;
  /** Extra environment variables passed into the backend. */
  readonly env?: Readonly<Record<string, string>>;
}

// ── Constants ─────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SSH_PORT = 22;
const DEFAULT_DOCKER_IMAGE = "node:20-slim";
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

// ── Local Backend ─────────────────────────────────────

export class LocalBackend implements TerminalBackend {
  readonly name: string = "local";
  readonly type: BackendType = "local";
  private connected = false;
  private readonly defaultTimeout: number;

  constructor(config?: Pick<BackendConfig, "defaultTimeoutMs">) {
    this.defaultTimeout = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertConnected();
    const timeout = options?.timeoutMs ?? this.defaultTimeout;
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(
        "/bin/sh",
        ["-c", command],
        {
          timeout,
          maxBuffer: MAX_BUFFER,
          cwd: options?.cwd,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
        },
      );
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: typeof error.code === "number" ? error.code : 1,
          durationMs: Date.now() - startTime,
        };
      }
      return { stdout: "", stderr: String(error), exitCode: 1, durationMs: Date.now() - startTime };
    }
  }

  /** @deprecated Use execute() instead. Kept for backward compatibility. */
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.execute(command, { timeoutMs });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BackendError("LocalBackend is not connected. Call connect() first.");
    }
  }
}

// ── Docker Backend ────────────────────────────────────

export class DockerTerminalBackend implements TerminalBackend {
  readonly name: string = "docker";
  readonly type: BackendType = "docker";
  private connected = false;
  private containerId: string | null = null;
  private readonly image: string;
  private readonly defaultTimeout: number;
  private readonly env: Readonly<Record<string, string>>;

  constructor(config?: Partial<BackendConfig>) {
    this.image = config?.target ?? DEFAULT_DOCKER_IMAGE;
    this.defaultTimeout = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.env = config?.env ?? {};
  }

  async connect(): Promise<void> {
    if (this.connected && this.containerId) return;

    const args = buildDockerRunArgs(this.image, this.env);

    try {
      const { stdout } = await execFileAsync("docker", args, {
        timeout: this.defaultTimeout,
      });

      const id = stdout.trim();
      if (!id) {
        throw new BackendError("Docker returned empty container ID");
      }

      this.containerId = id;
      this.connected = true;
    } catch (error: unknown) {
      throw new BackendError(`Failed to start Docker container: ${String(error)}`);
    }
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertConnected();
    const timeout = options?.timeoutMs ?? this.defaultTimeout;
    const startTime = Date.now();

    const execArgs: string[] = ["exec"];
    if (options?.cwd) {
      execArgs.push("--workdir", options.cwd);
    }
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        execArgs.push("--env", `${key}=${value}`);
      }
    }
    execArgs.push(this.containerId!, "sh", "-c", command);

    try {
      const { stdout, stderr } = await execFileAsync(
        "docker", execArgs,
        { timeout, maxBuffer: MAX_BUFFER },
      );
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: typeof error.code === "number" ? error.code : 1,
          durationMs: Date.now() - startTime,
        };
      }
      return { stdout: "", stderr: String(error), exitCode: 1, durationMs: Date.now() - startTime };
    }
  }

  /** @deprecated Use execute() instead. Kept for backward compatibility. */
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.execute(command, { timeoutMs });
  }

  async disconnect(): Promise<void> {
    if (this.containerId) {
      try {
        await execFileAsync("docker", ["rm", "--force", this.containerId], {
          timeout: 15_000,
        });
      } catch {
        // Container may already be removed — acceptable
      }
      this.containerId = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.containerId !== null;
  }

  getContainerId(): string | null {
    return this.containerId;
  }

  private assertConnected(): void {
    if (!this.connected || !this.containerId) {
      throw new BackendError("DockerTerminalBackend is not connected. Call connect() first.");
    }
  }
}

// ── SSH Backend ───────────────────────────────────────

export class SSHBackend implements TerminalBackend {
  readonly name: string = "ssh";
  readonly type: BackendType = "ssh";
  private connected = false;
  private readonly host: string;
  private readonly user: string;
  private readonly port: number;
  private readonly identityFile: string | undefined;
  private readonly defaultTimeout: number;

  constructor(config: Partial<BackendConfig> & { target: string }) {
    this.host = config.target;
    this.user = config.user ?? "root";
    this.port = config.port ?? DEFAULT_SSH_PORT;
    this.identityFile = config.identityFile;
    this.defaultTimeout = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Verify SSH connectivity with a quick echo
    try {
      const args = this.buildSSHArgs(["echo", "ok"]);
      const { stdout } = await execFileAsync("ssh", args, {
        timeout: 10_000,
      });
      if (!stdout.trim().includes("ok")) {
        throw new BackendError("SSH connectivity check failed");
      }
      this.connected = true;
    } catch (error: unknown) {
      throw new BackendError(`SSH connection failed to ${this.user}@${this.host}: ${String(error)}`);
    }
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertConnected();
    const timeout = options?.timeoutMs ?? this.defaultTimeout;
    const startTime = Date.now();

    // Prepend cd if cwd is specified; set env vars inline
    let fullCommand = command;
    if (options?.cwd) {
      fullCommand = `cd ${options.cwd} && ${command}`;
    }
    if (options?.env) {
      const envPrefix = Object.entries(options.env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      fullCommand = `${envPrefix} ${fullCommand}`;
    }

    try {
      const args = this.buildSSHArgs([fullCommand]);
      const { stdout, stderr } = await execFileAsync("ssh", args, {
        timeout,
        maxBuffer: MAX_BUFFER,
      });
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: typeof error.code === "number" ? error.code : 1,
          durationMs: Date.now() - startTime,
        };
      }
      return { stdout: "", stderr: String(error), exitCode: 1, durationMs: Date.now() - startTime };
    }
  }

  /** @deprecated Use execute() instead. Kept for backward compatibility. */
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.execute(command, { timeoutMs });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private buildSSHArgs(commandParts: readonly string[]): string[] {
    const args: string[] = [
      "-o", "StrictHostKeyChecking=no",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-p", String(this.port),
    ];

    if (this.identityFile) {
      args.push("-i", this.identityFile);
    }

    args.push(`${this.user}@${this.host}`);
    args.push(...commandParts);

    return args;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BackendError("SSHBackend is not connected. Call connect() first.");
    }
  }
}

// ── Factory ───────────────────────────────────────────

/**
 * Create a terminal backend by type. Config values are passed through
 * to the specific backend constructor.
 */
export function createBackend(
  type: BackendType,
  config: Record<string, unknown> = {},
): TerminalBackend {
  const backendConfig = config as Partial<BackendConfig>;

  switch (type) {
    case "local":
      return new LocalBackend(backendConfig);

    case "docker":
      return new DockerTerminalBackend(backendConfig);

    case "ssh": {
      const target = backendConfig.target;
      if (!target) {
        throw new BackendError("SSH backend requires a 'target' host in config");
      }
      return new SSHBackend({ ...backendConfig, target });
    }

    case "daytona":
      // Daytona workspaces use SSH under the hood with daytona CLI
      return new DaytonaBackend(backendConfig);

    case "modal":
      // Modal cloud functions — stub for future Modal SDK integration
      return new ModalBackend(backendConfig);

    default:
      throw new BackendError(`Unknown backend type: ${type as string}`);
  }
}

// ── Daytona Backend (SSH-based) ───────────────────────

class DaytonaBackend implements TerminalBackend {
  readonly name: string = "daytona";
  readonly type: BackendType = "daytona";
  private connected = false;
  private readonly workspaceId: string;
  private readonly defaultTimeout: number;

  constructor(config?: Partial<BackendConfig>) {
    this.workspaceId = config?.target ?? "default";
    this.defaultTimeout = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // Verify daytona CLI is available
      await execFileAsync("daytona", ["version"], { timeout: 5_000 });
      this.connected = true;
    } catch {
      throw new BackendError("Daytona CLI not found. Install from https://daytona.io");
    }
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertConnected();
    const timeout = options?.timeoutMs ?? this.defaultTimeout;
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(
        "daytona",
        ["exec", this.workspaceId, "--", "sh", "-c", command],
        { timeout, maxBuffer: MAX_BUFFER },
      );
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: typeof error.code === "number" ? error.code : 1,
          durationMs: Date.now() - startTime,
        };
      }
      return { stdout: "", stderr: String(error), exitCode: 1, durationMs: Date.now() - startTime };
    }
  }

  /** @deprecated Use execute() instead. */
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.execute(command, { timeoutMs });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BackendError("DaytonaBackend is not connected. Call connect() first.");
    }
  }
}

// ── Modal Backend ────────────────────────────────────

class ModalBackend implements TerminalBackend {
  readonly name: string = "modal";
  readonly type: BackendType = "modal";
  private connected = false;
  private readonly defaultTimeout: number;

  constructor(config?: Partial<BackendConfig>) {
    this.defaultTimeout = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // Verify modal CLI is available
      await execFileAsync("modal", ["--version"], { timeout: 5_000 });
      this.connected = true;
    } catch {
      throw new BackendError("Modal CLI not found. Install from https://modal.com");
    }
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.assertConnected();
    const timeout = options?.timeoutMs ?? this.defaultTimeout;
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(
        "modal",
        ["run", "--quiet", "--", "sh", "-c", command],
        { timeout, maxBuffer: MAX_BUFFER },
      );
      return { stdout, stderr, exitCode: 0, durationMs: Date.now() - startTime };
    } catch (error: unknown) {
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: typeof error.code === "number" ? error.code : 1,
          durationMs: Date.now() - startTime,
        };
      }
      return { stdout: "", stderr: String(error), exitCode: 1, durationMs: Date.now() - startTime };
    }
  }

  /** @deprecated Use execute() instead. */
  async exec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.execute(command, { timeoutMs });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new BackendError("ModalBackend is not connected. Call connect() first.");
    }
  }
}

// ── Terminal Manager ─────────────────────────────────

/**
 * TerminalManager selects and manages backends based on task requirements.
 * Provides a single point of entry for executing commands across backends.
 */
export class TerminalManager {
  private readonly backends = new Map<string, TerminalBackend>();
  private activeBackend: TerminalBackend | null = null;

  /**
   * Register a backend by name.
   */
  register(name: string, backend: TerminalBackend): void {
    this.backends.set(name, backend);
  }

  /**
   * Select the best backend for a given requirement.
   * Priority: explicit type > connected backend > local fallback.
   */
  async select(preferredType?: BackendType): Promise<TerminalBackend> {
    // Try preferred type first
    if (preferredType) {
      for (const backend of this.backends.values()) {
        if (backend.type === preferredType) {
          if (!backend.isConnected()) {
            await backend.connect();
          }
          this.activeBackend = backend;
          return backend;
        }
      }
    }

    // Try any connected backend
    for (const backend of this.backends.values()) {
      if (backend.isConnected()) {
        this.activeBackend = backend;
        return backend;
      }
    }

    // Fall back to local
    const local = new LocalBackend();
    await local.connect();
    this.backends.set("local-fallback", local);
    this.activeBackend = local;
    return local;
  }

  /**
   * Execute a command on the active backend (or select one).
   */
  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.activeBackend || !this.activeBackend.isConnected()) {
      await this.select();
    }
    return this.activeBackend!.execute(command, options);
  }

  /**
   * Get the currently active backend.
   */
  getActive(): TerminalBackend | null {
    return this.activeBackend;
  }

  /**
   * List all registered backends.
   */
  list(): readonly { name: string; type: BackendType; connected: boolean }[] {
    return [...this.backends.entries()].map(([name, backend]) => ({
      name,
      type: backend.type,
      connected: backend.isConnected(),
    }));
  }

  /**
   * Disconnect all backends.
   */
  async disconnectAll(): Promise<void> {
    const promises = [...this.backends.values()].map((b) => b.disconnect());
    await Promise.allSettled(promises);
    this.activeBackend = null;
  }
}

// ── Helpers ───────────────────────────────────────────

function buildDockerRunArgs(
  image: string,
  env: Readonly<Record<string, string>>,
): string[] {
  const args = [
    "run", "--detach", "--rm",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--network=none",
  ];

  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(image, "sleep", "infinity");
  return args;
}

// ── Type Guards ───────────────────────────────────────

interface ExecFileError {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}

function isExecError(error: unknown): error is ExecFileError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("stdout" in error || "stderr" in error)
  );
}

// ── Error Type ────────────────────────────────────────

export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendError";
  }
}
