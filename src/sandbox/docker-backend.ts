/**
 * Docker Container Sandbox — isolated code execution via Docker containers.
 *
 * Provides safe, sandboxed execution of arbitrary commands inside Docker
 * containers with configurable network policies, memory limits, and timeouts.
 *
 * Security: Uses execFile (never exec) to prevent shell injection on the host.
 * Commands run inside the container via `sh -c` which is the intended isolation
 * boundary — the container itself is the sandbox.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Public Types ──────────────────────────────────────

export interface VolumeMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readOnly: boolean;
}

export interface SandboxConfig {
  readonly tier: "local" | "docker" | "kubernetes";
  readonly image: string;
  readonly memoryMb: number;
  readonly cpuLimit: number;
  readonly timeoutMs: number;
  readonly networkPolicy: "none" | "restricted" | "full";
  readonly volumes: readonly VolumeMount[];
}

/**
 * SandboxProvider — unified interface for the 3-tier sandbox system.
 *
 * Tier 1 (local): Seatbelt on macOS, Landlock on Linux
 * Tier 2 (docker): Docker Desktop containers with isolation
 * Tier 3 (kubernetes): Production-grade pod isolation
 *
 * All tiers implement this interface so the runtime can swap backends
 * transparently based on the `--sandbox` CLI flag.
 */
export interface SandboxProvider {
  readonly tier: SandboxConfig["tier"];
  isAvailable(): Promise<boolean>;
  createContainer(config: SandboxConfig): Promise<string>;
  executeInContainer(containerId: string, command: string, workdir?: string): Promise<ExecutionResult>;
  destroyContainer(containerId: string): Promise<void>;
  listContainers(): readonly ContainerInfo[];
}

/**
 * DeerFlow-style virtual path mapping.
 *
 * Maps well-known virtual paths to container-internal locations.
 * Agent code uses virtual paths like `/workspace/` and the sandbox
 * resolves them to actual host mounts at container creation time.
 */
export interface VirtualPathMap {
  /** Project source code (host project dir -> /workspace/) */
  readonly workspace: string;
  /** User-uploaded files (host uploads dir -> /uploads/) */
  readonly uploads: string;
  /** Agent-generated outputs (host outputs dir -> /outputs/) */
  readonly outputs: string;
}

export const DEFAULT_VIRTUAL_PATHS: Readonly<Record<keyof VirtualPathMap, string>> = {
  workspace: "/workspace",
  uploads: "/uploads",
  outputs: "/outputs",
} as const;

export interface DockerSandboxConfig {
  readonly image: string;
  readonly workspaceMount: string;
  readonly networkPolicy: "none" | "restricted" | "full";
  readonly memoryLimitMb: number;
  readonly timeoutMs: number;
  readonly cpuLimit?: number;
  readonly readOnlyRoot?: boolean;
  readonly envVars?: Readonly<Record<string, string>>;
}

export interface ExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly oomKilled: boolean;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ContainerInfo {
  readonly containerId: string;
  readonly image: string;
  readonly status: "created" | "running" | "stopped" | "removed";
  readonly createdAt: string;
}

// ── Constants ─────────────────────────────────────────

const DEFAULT_IMAGE = "node:20-slim";
const DEFAULT_MEMORY_LIMIT_MB = 512;
const DEFAULT_TIMEOUT_MS = 30_000;
const DOCKER_BINARY = "docker";
const CONTAINER_WORKSPACE = "/workspace";

/**
 * Network mode mapping for Docker --network flag.
 */
const NETWORK_MAP: Record<DockerSandboxConfig["networkPolicy"], string> = {
  none: "none",
  restricted: "bridge",
  full: "bridge",
};

// ── Docker Sandbox ────────────────────────────────────

export class DockerSandbox implements SandboxProvider {
  readonly tier = "docker" as const;
  private readonly containers = new Map<string, ContainerInfo>();

  /**
   * Check whether Docker is installed and the daemon is running.
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(DOCKER_BINARY, ["info", "--format", "{{.ServerVersion}}"], {
        timeout: 5_000,
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Create a new sandboxed container with the given configuration.
   * Returns the container ID. The container is started but idle (sleeps).
   */
  async create(config: DockerSandboxConfig): Promise<string> {
    const args = buildCreateArgs(config);

    const { stdout } = await execFileAsync(DOCKER_BINARY, args, {
      timeout: config.timeoutMs || DEFAULT_TIMEOUT_MS,
    });

    const containerId = stdout.trim();
    if (!containerId) {
      throw new DockerSandboxError("Failed to create container: no container ID returned");
    }

    this.containers.set(containerId, {
      containerId,
      image: config.image || DEFAULT_IMAGE,
      status: "running",
      createdAt: new Date().toISOString(),
    });

    return containerId;
  }

  /**
   * Execute a command inside an existing container.
   * Returns stdout, stderr, and exit code.
   *
   * Note: The command runs inside the container's shell (sh -c).
   * This is safe because the container IS the sandbox boundary.
   */
  async exec(containerId: string, command: string): Promise<ExecResult> {
    this.assertContainerExists(containerId);

    try {
      const { stdout, stderr } = await execFileAsync(
        DOCKER_BINARY,
        ["exec", containerId, "sh", "-c", command],
        {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
        },
      );

      return { stdout, stderr, exitCode: 0 };
    } catch (error: unknown) {
      // execFile throws on non-zero exit codes
      if (isExecError(error)) {
        return {
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          exitCode: error.code ?? 1,
        };
      }
      throw new DockerSandboxError(
        `Failed to execute command in container ${containerId}: ${String(error)}`,
      );
    }
  }

  /**
   * Destroy (stop and remove) a container.
   */
  async destroy(containerId: string): Promise<void> {
    try {
      // Force stop + remove in one go
      await execFileAsync(
        DOCKER_BINARY,
        ["rm", "--force", containerId],
        { timeout: 15_000 },
      );
    } catch {
      // Container may already be removed — that's fine
    }

    const info = this.containers.get(containerId);
    if (info) {
      this.containers.set(containerId, { ...info, status: "removed" });
    }
    this.containers.delete(containerId);
  }

  /**
   * Destroy all tracked containers.
   */
  async destroyAll(): Promise<number> {
    const ids = [...this.containers.keys()];
    const results = await Promise.allSettled(
      ids.map((id) => this.destroy(id)),
    );
    return results.filter((r) => r.status === "fulfilled").length;
  }

  /**
   * List all tracked containers.
   */
  listContainers(): readonly ContainerInfo[] {
    return [...this.containers.values()];
  }

  /**
   * Get info about a specific container.
   */
  getContainer(containerId: string): ContainerInfo | undefined {
    return this.containers.get(containerId);
  }

  /**
   * Check if a specific container is still running.
   */
  async isRunning(containerId: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        DOCKER_BINARY,
        ["inspect", "--format", "{{.State.Running}}", containerId],
        { timeout: 5_000 },
      );
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Alias for isDockerAvailable() — matches spec interface.
   */
  async isAvailable(): Promise<boolean> {
    return this.isDockerAvailable();
  }

  /**
   * Execute a command in the sandbox with full result metadata.
   * Returns ExecutionResult with durationMs and oomKilled detection.
   */
  async execute(command: string, workdir?: string): Promise<ExecutionResult> {
    // Find a running container, or create one with defaults
    const running = [...this.containers.entries()].find(
      ([, info]) => info.status === "running",
    );

    let containerId: string;
    if (running) {
      containerId = running[0];
    } else {
      containerId = await this.create({
        image: DEFAULT_IMAGE,
        workspaceMount: "",
        networkPolicy: "none",
        memoryLimitMb: DEFAULT_MEMORY_LIMIT_MB,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    }

    const startTime = Date.now();
    const execArgs = workdir
      ? ["exec", "--workdir", workdir, containerId, "sh", "-c", command]
      : ["exec", containerId, "sh", "-c", command];

    try {
      const { stdout, stderr } = await execFileAsync(
        DOCKER_BINARY, execArgs,
        { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );

      return {
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        oomKilled: false,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (isExecError(error)) {
        // Check if the container was OOM killed
        const oomKilled = await this.checkOomKilled(containerId);
        return {
          exitCode: error.code ?? 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          durationMs,
          oomKilled,
        };
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: String(error),
        durationMs,
        oomKilled: false,
      };
    }
  }

  /**
   * Create a sandbox with a mounted workspace directory.
   * Returns the container ID.
   */
  async createWorkspace(projectDir: string): Promise<string> {
    return this.create({
      image: DEFAULT_IMAGE,
      workspaceMount: projectDir,
      networkPolicy: "restricted",
      memoryLimitMb: DEFAULT_MEMORY_LIMIT_MB,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  // ── SandboxProvider Interface Methods ─────────────────

  /**
   * Create a container from a SandboxConfig (SandboxProvider interface).
   * Translates the generic SandboxConfig into DockerSandboxConfig.
   */
  async createContainer(config: SandboxConfig): Promise<string> {
    const volumes = config.volumes.map((v) => ({
      hostPath: v.hostPath,
      containerPath: v.containerPath,
      readOnly: v.readOnly,
    }));

    // Use the first volume's host path as workspace mount, or empty string
    const workspaceMount = volumes.find((v) => v.containerPath === CONTAINER_WORKSPACE)?.hostPath ?? "";

    return this.create({
      image: config.image || DEFAULT_IMAGE,
      workspaceMount,
      networkPolicy: config.networkPolicy,
      memoryLimitMb: config.memoryMb || DEFAULT_MEMORY_LIMIT_MB,
      timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT_MS,
      cpuLimit: config.cpuLimit > 0 ? config.cpuLimit : undefined,
    });
  }

  /**
   * Execute a command in a container (SandboxProvider interface).
   */
  async executeInContainer(containerId: string, command: string, workdir?: string): Promise<ExecutionResult> {
    this.assertContainerExists(containerId);

    const startTime = Date.now();
    const execArgs = workdir
      ? ["exec", "--workdir", workdir, containerId, "sh", "-c", command]
      : ["exec", containerId, "sh", "-c", command];

    try {
      const { stdout, stderr } = await execFileAsync(
        DOCKER_BINARY, execArgs,
        { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );

      return {
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        oomKilled: false,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (isExecError(error)) {
        const oomKilled = await this.checkOomKilled(containerId);
        return {
          exitCode: error.code ?? 1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
          durationMs,
          oomKilled,
        };
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: String(error),
        durationMs,
        oomKilled: false,
      };
    }
  }

  /**
   * Destroy a container (SandboxProvider interface).
   * Alias for destroy() to match the SandboxProvider contract.
   */
  async destroyContainer(containerId: string): Promise<void> {
    return this.destroy(containerId);
  }

  // ── DeerFlow Virtual Path Support ───────────────────────

  /**
   * Create a sandbox container with DeerFlow-style virtual path mapping.
   *
   * Maps well-known virtual paths to container-internal locations:
   * - /workspace/ -> project source code (read-write)
   * - /uploads/   -> user-uploaded files (read-only)
   * - /outputs/   -> agent-generated outputs (read-write)
   *
   * This allows agent code to use stable virtual paths regardless
   * of the actual host directory layout.
   */
  async createWithVirtualPaths(
    projectDir: string,
    pathMap?: Partial<VirtualPathMap>,
    config?: Partial<DockerSandboxConfig>,
  ): Promise<string> {
    const uploadsDir = pathMap?.uploads ?? `${projectDir}/.wotann/uploads`;
    const outputsDir = pathMap?.outputs ?? `${projectDir}/.wotann/outputs`;

    // Build volume args for the virtual path mapping
    const volumeArgs = buildVirtualPathVolumes(projectDir, uploadsDir, outputsDir);

    const fullConfig: DockerSandboxConfig = {
      image: config?.image ?? DEFAULT_IMAGE,
      workspaceMount: projectDir,
      networkPolicy: config?.networkPolicy ?? "restricted",
      memoryLimitMb: config?.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB,
      timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cpuLimit: config?.cpuLimit,
      readOnlyRoot: config?.readOnlyRoot,
      envVars: config?.envVars,
    };

    const args = buildCreateArgs(fullConfig);
    // Insert extra volume mounts before the image argument
    const imageIndex = args.indexOf(fullConfig.image || DEFAULT_IMAGE);
    const argsWithVolumes = [
      ...args.slice(0, imageIndex),
      ...volumeArgs,
      ...args.slice(imageIndex),
    ];

    const { stdout } = await execFileAsync(DOCKER_BINARY, [...argsWithVolumes], {
      timeout: fullConfig.timeoutMs || DEFAULT_TIMEOUT_MS,
    });

    const containerId = stdout.trim();
    if (!containerId) {
      throw new DockerSandboxError("Failed to create container with virtual paths: no container ID returned");
    }

    this.containers.set(containerId, {
      containerId,
      image: fullConfig.image || DEFAULT_IMAGE,
      status: "running",
      createdAt: new Date().toISOString(),
    });

    return containerId;
  }

  /**
   * Copy a file from the host into the container.
   */
  async copyToContainer(
    containerId: string,
    hostPath: string,
    containerPath: string,
  ): Promise<void> {
    this.assertContainerExists(containerId);

    await execFileAsync(
      DOCKER_BINARY,
      ["cp", hostPath, `${containerId}:${containerPath}`],
      { timeout: 30_000 },
    );
  }

  /**
   * Copy a file from the container to the host.
   */
  async copyFromContainer(
    containerId: string,
    containerPath: string,
    hostPath: string,
  ): Promise<void> {
    this.assertContainerExists(containerId);

    await execFileAsync(
      DOCKER_BINARY,
      ["cp", `${containerId}:${containerPath}`, hostPath],
      { timeout: 30_000 },
    );
  }

  // ── Private Helpers ─────────────────────────────────

  private assertContainerExists(containerId: string): void {
    if (!this.containers.has(containerId)) {
      throw new DockerSandboxError(`Unknown container: ${containerId}`);
    }
  }

  /**
   * Check if a container was OOM (Out of Memory) killed.
   */
  private async checkOomKilled(containerId: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        DOCKER_BINARY,
        ["inspect", "--format", "{{.State.OOMKilled}}", containerId],
        { timeout: 5_000 },
      );
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }
}

// ── Argument Building ─────────────────────────────────

/**
 * Build the `docker run` argument list from sandbox config.
 */
function buildCreateArgs(config: DockerSandboxConfig): readonly string[] {
  const image = config.image || DEFAULT_IMAGE;
  const memoryMb = config.memoryLimitMb || DEFAULT_MEMORY_LIMIT_MB;

  const args: string[] = [
    "run",
    "--detach",
    "--rm",
    // Memory limit
    `--memory=${memoryMb}m`,
    `--memory-swap=${memoryMb}m`, // No swap
    // Network policy
    `--network=${NETWORK_MAP[config.networkPolicy]}`,
    // Security: drop all capabilities, no new privileges
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
  ];

  // CPU limit
  if (config.cpuLimit !== undefined && config.cpuLimit > 0) {
    args.push(`--cpus=${config.cpuLimit}`);
  }

  // Read-only root filesystem
  if (config.readOnlyRoot) {
    args.push("--read-only");
    // /tmp still needs to be writable
    args.push("--tmpfs=/tmp:rw,noexec,nosuid,size=64m");
  }

  // Workspace mount
  if (config.workspaceMount) {
    args.push(`--volume=${config.workspaceMount}:${CONTAINER_WORKSPACE}:rw`);
    args.push(`--workdir=${CONTAINER_WORKSPACE}`);
  }

  // Environment variables
  if (config.envVars) {
    for (const [key, value] of Object.entries(config.envVars)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  // Network isolation flags:
  // "none"       -> --network=none (fully airgapped, no network stack)
  // "restricted" -> bridge network + DNS limited to localhost + no raw sockets
  // "full"       -> bridge network with default Docker networking
  if (config.networkPolicy === "restricted") {
    args.push("--dns=127.0.0.1");
    // Prevent raw socket creation (blocks network scanning)
    args.push("--sysctl=net.ipv4.ping_group_range=1 0");
  }

  // PID namespace isolation: prevent process enumeration of host
  args.push("--pids-limit=256");

  // Image and idle command (sleep so container stays alive for exec)
  args.push(image);
  args.push("sleep");
  args.push("infinity");

  return args;
}

/**
 * Build extra volume mount arguments for DeerFlow virtual path mapping.
 * The workspace volume is handled by buildCreateArgs; this adds /uploads/ and /outputs/.
 */
function buildVirtualPathVolumes(
  _projectDir: string,
  uploadsDir: string,
  outputsDir: string,
): readonly string[] {
  return [
    `--volume=${uploadsDir}:${DEFAULT_VIRTUAL_PATHS.uploads}:ro`,
    `--volume=${outputsDir}:${DEFAULT_VIRTUAL_PATHS.outputs}:rw`,
  ];
}

// ── Type Guards ───────────────────────────────────────

interface ExecFileError {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function isExecError(error: unknown): error is ExecFileError {
  return (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    "stderr" in error
  );
}

// ── Error Type ────────────────────────────────────────

export class DockerSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerSandboxError";
  }
}
