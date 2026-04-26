/**
 * KAIROS IPC — Unix Domain Socket server for CLI/Desktop communication.
 *
 * The KAIROS daemon listens on a UDS (~/.wotann/kairos.sock) for
 * incoming JSON-RPC connections from CLI and Desktop surfaces.
 * Each connection gets its own session and can send queries,
 * manage agents, and receive streaming responses.
 */

import { createConnection, createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { KairosRPCHandler, type RPCResponse, type RPCStreamEvent } from "./kairos-rpc.js";

// ── Session Token (B1) ───────────────────────────────────
//
// The daemon writes ~/.wotann/session-token.json at startup with a
// freshly-generated 32-byte token. Trusted local surfaces (the CLI, the
// Desktop shell, and tests running inside the project) read this file and
// include the token in every IPC/RPC request so that untrusted local
// processes — other users on the machine, unrelated apps, or anything that
// happens to connect to the Unix Domain Socket — cannot drive the daemon.
//
// See `writeSessionToken` in kairos-rpc-auth.ts for the writer side (called
// by the daemon at start). The socket file is already chmod 0600, but this
// adds defence-in-depth for shared hosts or ACL-weak filesystems.

/** Path to the shared daemon session-token file. */
const SESSION_TOKEN_PATH = resolveWotannHomeSubdir("session-token.json");

/**
 * RPC methods that do NOT require a session token (bootstrapping / health).
 *
 * SECURITY (SB-5): `auth.handshake` was previously listed here with the
 * justification that "iOS/desktop pull the token via this endpoint after
 * ECDH-encrypted pairing." That claim was unverified — iOS actually pairs
 * over the CompanionServer WebSocket (see src/desktop/companion-server.ts,
 * `pair`/`pair.local` handlers), not over the kairos IPC socket, so the
 * exemption gave any local process with UDS connectivity a free path to
 * the daemon session token. The 0600 permission on ~/.wotann/session-token.json
 * already restricts disk access to the owning user; legitimate IPC clients
 * read the token directly from that file (see KairosIPCClient.call which
 * calls readSessionToken before sending). The exemption is therefore both
 * unnecessary and dangerous, so it has been removed.
 */
const UNAUTH_IPC_METHODS: ReadonlySet<string> = new Set(["ping", "keepalive"]);

interface SessionTokenFile {
  readonly token: string;
  readonly createdAt: number;
  readonly pid: number;
}

/** Read the daemon session token. Returns null when missing/corrupt. */
function readSessionTokenFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SessionTokenFile>;
    return typeof parsed.token === "string" && parsed.token.length >= 32 ? parsed.token : null;
  } catch {
    return null;
  }
}

/**
 * Extract the `X-WOTANN-Token` metadata field (or `authToken` param fallback)
 * from a parsed RPC request. Returns "" when absent.
 */
function extractIPCToken(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      params?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    const metaToken = parsed.metadata?.["X-WOTANN-Token"];
    if (typeof metaToken === "string") return metaToken;
    const paramToken = parsed.params?.["authToken"] ?? parsed.params?.["sessionToken"];
    if (typeof paramToken === "string") return paramToken;
    return "";
  } catch {
    return "";
  }
}

/**
 * Generate a fresh 32-byte session token and persist it to
 * ~/.wotann/session-token.json with mode 0600. Called by the daemon at
 * startup so only the owning user can read it.
 *
 * Returns the new token. Idempotent for the current process (overwrites any
 * previous token because the daemon owns the file for its lifetime).
 */
export function writeSessionToken(path: string = SESSION_TOKEN_PATH): string {
  const token = randomBytes(32).toString("hex");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload: SessionTokenFile = {
    token,
    createdAt: Date.now(),
    pid: process.pid,
  };
  // Wave 6.5-UU (H-22) — daemon session token is the bearer credential for
  // every IPC/RPC call. Atomic write so a crash mid-write doesn't leave
  // CLI clients with a half-written token they can't authenticate with.
  writeFileAtomic(path, JSON.stringify(payload), { mode: 0o600 });
  // writeFileSync's mode is only applied on creation; chmod again so the
  // permissions survive when we overwrite an existing file.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Non-fatal: some filesystems (notably networked mounts) may refuse chmod.
  }
  return token;
}

/**
 * Read the current session token (used by in-process clients like the
 * daemon itself and local tests). Returns null when the file is missing or
 * malformed.
 */
export function readSessionToken(path: string = SESSION_TOKEN_PATH): string | null {
  return readSessionTokenFile(path);
}

/**
 * Check whether the incoming RPC should be admitted. Authentication is
 * granted when the method is in UNAUTH_IPC_METHODS or when the supplied
 * token matches the daemon's session-token file on disk.
 *
 * V9 Wave 6-RR (SB-8): the previous `WOTANN_AUTH_BYPASS=1 + NODE_ENV=test`
 * env-var bypass has been REMOVED. NODE_ENV is attacker-controllable in
 * many launch scenarios (cron jobs, CI runners, supervised processes,
 * shell-injected env), so the gate was effectively defeated by anyone
 * who could set two env vars on the daemon process. Tests must instead
 * go through the real session-token file path — `readSessionToken(...)`
 * returns a fixture token they can include in their RPC requests, and
 * tests can pass a `tokenPath` override pointing at a per-test fixture.
 */
export function isIPCRequestAuthorized(
  raw: string,
  tokenPath: string = SESSION_TOKEN_PATH,
): boolean {
  let method = "";
  try {
    const parsed = JSON.parse(raw) as { method?: string };
    method = typeof parsed.method === "string" ? parsed.method : "";
  } catch {
    return false;
  }
  if (UNAUTH_IPC_METHODS.has(method)) return true;

  const expected = readSessionTokenFile(tokenPath);
  if (!expected) return false;
  // SECURITY (SB-2): constant-time token comparison via crypto.timingSafeEqual.
  // A `===` string comparison on session tokens leaks token bytes via timing
  // — Node's string equality short-circuits on the first byte mismatch. An
  // attacker probing the IPC socket could recover the token byte-by-byte.
  // timingSafeEqual requires equal-length buffers, so we length-check first
  // and treat any mismatched length as unauthorized.
  const provided = extractIPCToken(raw);
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// ── Types ────────────────────────────────────────────────

export interface IPCServerConfig {
  readonly socketPath: string;
  readonly maxConnections: number;
  readonly keepAliveMs: number;
}

export interface IPCConnection {
  readonly id: string;
  readonly socket: Socket;
  readonly connectedAt: number;
  readonly surface: "cli" | "desktop" | "unknown";
  readonly sessionId: string | null;
}

interface IPCMessage {
  readonly data: string;
  readonly connectionId: string;
}

// ── Default Config ───────────────────────────────────────

const DEFAULT_SOCKET_PATH = resolveWotannHomeSubdir("kairos.sock");

const DEFAULT_CONFIG: IPCServerConfig = {
  socketPath: DEFAULT_SOCKET_PATH,
  maxConnections: 10,
  keepAliveMs: 60_000,
};

// ── IPC Server ───────────────────────────────────────────

export class KairosIPCServer {
  private readonly config: IPCServerConfig;
  private readonly rpcHandler: KairosRPCHandler;
  private readonly connections: Map<string, IPCConnection> = new Map();
  private server: Server | null = null;
  private connectionCounter = 0;

  constructor(rpcHandler: KairosRPCHandler, config?: Partial<IPCServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rpcHandler = rpcHandler;
  }

  /**
   * Start the IPC server on the Unix Domain Socket.
   */
  start(): void {
    // Clean up stale socket file
    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }

    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.maxConnections = this.config.maxConnections;

    this.server.listen(this.config.socketPath, () => {
      // SECURITY (B1): enforce owner-only permissions on the UDS.
      // The socket file is created by the OS when listen() succeeds. Immediately
      // restrict it to mode 0600 so that other users on the system cannot connect.
      // chmod on sockets is a no-op on some platforms (e.g. certain BSDs), but
      // on Linux and macOS this is an effective perimeter control.
      try {
        chmodSync(this.config.socketPath, 0o600);
      } catch (err) {
        console.error(
          "[KAIROS IPC] Failed to set 0600 permissions on socket:",
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    this.server.on("error", (err) => {
      console.error("[KAIROS IPC] Server error:", err.message);
    });
  }

  /**
   * Stop the IPC server and close all connections.
   */
  stop(): void {
    for (const conn of this.connections.values()) {
      conn.socket.end();
    }
    this.connections.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    if (existsSync(this.config.socketPath)) {
      unlinkSync(this.config.socketPath);
    }
  }

  /**
   * Check if the IPC server is running.
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Get information about connected clients.
   */
  getConnections(): readonly IPCConnection[] {
    return [...this.connections.values()];
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(message: RPCStreamEvent): void {
    const raw = JSON.stringify(message) + "\n";
    for (const conn of this.connections.values()) {
      if (!conn.socket.destroyed) {
        conn.socket.write(raw);
      }
    }
  }

  /**
   * Send a message to a specific connection.
   */
  send(connectionId: string, message: RPCResponse | RPCStreamEvent): void {
    const conn = this.connections.get(connectionId);
    if (conn && !conn.socket.destroyed) {
      conn.socket.write(JSON.stringify(message) + "\n");
    }
  }

  /**
   * Get the socket path this server is listening on.
   */
  getSocketPath(): string {
    return this.config.socketPath;
  }

  // ── Connection Handling ─────────────────────────────────

  private handleConnection(socket: Socket): void {
    const connectionId = `conn-${++this.connectionCounter}`;

    const connection: IPCConnection = {
      id: connectionId,
      socket,
      connectedAt: Date.now(),
      surface: "unknown",
      sessionId: null,
    };

    this.connections.set(connectionId, connection);

    // Buffer for incomplete messages (newline-delimited JSON)
    let buffer = "";

    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8");

      // Process complete messages (newline-delimited)
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          void this.handleMessage({ data: trimmed, connectionId });
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(connectionId);
    });

    socket.on("error", (err) => {
      console.error(`[KAIROS IPC] Connection ${connectionId} error:`, err.message);
      this.connections.delete(connectionId);
    });

    // Keep-alive timeout
    socket.setTimeout(this.config.keepAliveMs, () => {
      // Send keepalive ping
      if (!socket.destroyed) {
        socket.write(JSON.stringify({ jsonrpc: "2.0", method: "keepalive", params: {} }) + "\n");
      }
    });
  }

  private async handleMessage(msg: IPCMessage): Promise<void> {
    // SECURITY (B1): gate every non-exempt RPC behind the daemon session token.
    // Untrusted local processes connecting to the UDS (or any future transport)
    // cannot drive the runtime without the token from ~/.wotann/session-token.json.
    if (!isIPCRequestAuthorized(msg.data)) {
      let id: string | number | null = null;
      try {
        const parsed = JSON.parse(msg.data) as { id?: string | number };
        id = parsed.id ?? null;
      } catch {
        id = null;
      }
      this.send(msg.connectionId, {
        jsonrpc: "2.0",
        id: id ?? "",
        error: { code: -32001, message: "unauthorized" },
      } as RPCResponse);
      return;
    }

    const result = await this.rpcHandler.handleMessage(msg.data);

    if (Symbol.asyncIterator in (result as object)) {
      // Streaming response
      const generator = result as AsyncGenerator<RPCStreamEvent>;
      for await (const event of generator) {
        this.send(msg.connectionId, event);
      }
    } else {
      // Single response
      this.send(msg.connectionId, result as RPCResponse);
    }
  }
}

// ── IPC Client ───────────────────────────────────────────

export class KairosIPCClient {
  private readonly socketPath: string;
  private socket: Socket | null = null;
  private buffer = "";
  private responseCallbacks: Map<string | number, (response: RPCResponse) => void> = new Map();
  private streamCallbacks: Map<string, (event: RPCStreamEvent) => void> = new Map();
  private requestCounter = 0;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? DEFAULT_SOCKET_PATH;
  }

  /**
   * Connect to the KAIROS daemon.
   */
  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!existsSync(this.socketPath)) {
        resolve(false);
        return;
      }

      this.socket = createConnection(this.socketPath, () => {
        resolve(true);
      });

      this.socket.on("data", (data: Buffer) => {
        this.buffer += data.toString("utf-8");
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed) as RPCResponse | RPCStreamEvent;
            // V9 Wave 2-L: stream events use the discriminated method names
            // ("stream.text"/"stream.done"/"stream.error"/"stream.thinking"/
            // "stream.tool_use") so this guard accepts any "stream.*" method
            // instead of the legacy bare "stream" literal.
            if (
              "method" in msg &&
              typeof msg.method === "string" &&
              msg.method.startsWith("stream")
            ) {
              const event = msg as RPCStreamEvent;
              const callback = this.streamCallbacks.get(event.params.sessionId);
              callback?.(event);
            } else {
              const response = msg as RPCResponse;
              const callback = this.responseCallbacks.get(response.id);
              if (callback) {
                callback(response);
                this.responseCallbacks.delete(response.id);
              }
            }
          } catch {
            // Ignore malformed messages
          }
        }
      });

      this.socket.on("error", () => {
        resolve(false);
      });

      this.socket.on("close", () => {
        this.socket = null;
      });
    });
  }

  /**
   * Disconnect from the KAIROS daemon.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  /**
   * Check if connected to KAIROS.
   */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /**
   * Send an RPC request and wait for the response.
   */
  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected()) {
      throw new Error("Not connected to KAIROS daemon");
    }

    const id = ++this.requestCounter;

    // SECURITY (B1, SB-5): attach the daemon session token to every outgoing
    // RPC unless the caller supplied their own or the request is for an exempt
    // bootstrapping/health method (ping/keepalive). auth.handshake is NO
    // longer exempt — see UNAUTH_IPC_METHODS comment. The token is read from
    // the canonical ~/.wotann/session-token.json file, which is 0600 so only
    // the owning user can read it.
    const mergedParams: Record<string, unknown> = { ...(params ?? {}) };
    if (!UNAUTH_IPC_METHODS.has(method) && mergedParams["authToken"] === undefined) {
      const token = readSessionToken();
      if (token) mergedParams["authToken"] = token;
    }

    const request = { jsonrpc: "2.0", method, params: mergedParams, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseCallbacks.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30_000);

      this.responseCallbacks.set(id, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      });

      this.socket!.write(JSON.stringify(request) + "\n");
    });
  }

  /**
   * Subscribe to streaming events for a session.
   */
  onStream(sessionId: string, callback: (event: RPCStreamEvent) => void): void {
    this.streamCallbacks.set(sessionId, callback);
  }

  /**
   * Check if KAIROS daemon is running (socket exists).
   */
  static isDaemonRunning(socketPath?: string): boolean {
    return existsSync(socketPath ?? DEFAULT_SOCKET_PATH);
  }
}

// ── Connection Pool (F6) ─────────────────────────────────────
//
// Previously every RPC call allocated a fresh KairosIPCClient, connected,
// issued the request, and disconnected. On workloads that fan out hundreds
// of RPCs per second (the Workshop tab does this during a long agent run),
// that churn becomes a bottleneck.
//
// The pool keeps up to `maxConnections` connections per socket path, reuses
// idle connections via LRU, and closes idle connections after `idleMs`.

/** Options accepted by {@link KairosIPCPool}. */
export interface IPCPoolOptions {
  /** Max concurrent live connections per socket path. */
  readonly maxConnections?: number;
  /** Idle duration (ms) after which a connection is closed. */
  readonly idleMs?: number;
}

interface PoolEntry {
  readonly client: KairosIPCClient;
  /** Monotonic timestamp of the last time this client was released to the pool. */
  lastUsed: number;
  /** When true, another call is currently using this client. */
  inUse: boolean;
  /** Timer that closes the client after the idle window elapses. */
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Pool of KairosIPCClient instances keyed by socket path. Keeps idle
 * connections warm and evicts them after the idle window elapses.
 *
 * This is a module-level singleton so that every caller in the process
 * shares the same set of sockets — no reason to have two parallel pools
 * for the same socket path.
 */
export class KairosIPCPool {
  private readonly maxConnections: number;
  private readonly idleMs: number;
  /** Map socket path → entries (LRU order: [0] is least recently used). */
  private readonly entries: Map<string, PoolEntry[]> = new Map();

  constructor(options: IPCPoolOptions = {}) {
    this.maxConnections = options.maxConnections ?? 8;
    this.idleMs = options.idleMs ?? 60_000;
  }

  /**
   * Acquire a connected KairosIPCClient for the given socket path. Creates
   * a new connection if the pool is empty or all existing connections are
   * busy and we are under the concurrency cap. When the cap is reached the
   * caller waits for a connection to become available.
   */
  async acquire(socketPath: string = DEFAULT_SOCKET_PATH): Promise<KairosIPCClient> {
    const bucket = this.getBucket(socketPath);

    // Try to reuse an idle live connection (LRU → take from the front).
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i]!;
      if (entry.inUse) continue;
      if (!entry.client.isConnected()) {
        // Stale connection: drop it and keep searching.
        this.dropEntry(socketPath, entry);
        i--;
        continue;
      }
      this.markInUse(entry);
      return entry.client;
    }

    if (bucket.length < this.maxConnections) {
      const client = new KairosIPCClient(socketPath);
      const connected = await client.connect();
      if (!connected) {
        throw new Error(`[KairosIPCPool] Failed to connect to ${socketPath}`);
      }
      const entry: PoolEntry = {
        client,
        lastUsed: Date.now(),
        inUse: true,
        idleTimer: null,
      };
      bucket.push(entry);
      return client;
    }

    // All slots taken: wait for a release. We poll because the existing
    // client API does not expose completion events.
    return new Promise<KairosIPCClient>((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const existing = this.entries.get(socketPath) ?? [];
        for (const entry of existing) {
          if (!entry.inUse && entry.client.isConnected()) {
            clearInterval(timer);
            this.markInUse(entry);
            resolve(entry.client);
            return;
          }
        }
        if (Date.now() - start > 30_000) {
          clearInterval(timer);
          reject(new Error("[KairosIPCPool] Timed out waiting for a free connection"));
        }
      }, 50);
    });
  }

  /**
   * Release a previously acquired client back to the pool so it can be
   * reused. Schedules an idle-timeout timer that closes the socket after
   * the configured idle window.
   */
  release(client: KairosIPCClient, socketPath: string = DEFAULT_SOCKET_PATH): void {
    const bucket = this.entries.get(socketPath);
    if (!bucket) return;
    const entry = bucket.find((e) => e.client === client);
    if (!entry) return;
    entry.inUse = false;
    entry.lastUsed = Date.now();

    // Re-insert at the tail so oldest-used is at the head (LRU eviction).
    const idx = bucket.indexOf(entry);
    if (idx !== -1 && idx !== bucket.length - 1) {
      bucket.splice(idx, 1);
      bucket.push(entry);
    }

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.dropEntry(socketPath, entry);
    }, this.idleMs);
  }

  /**
   * Close every connection in the pool. Callers should invoke this on
   * graceful shutdown to drain sockets cleanly.
   */
  drain(): void {
    for (const [socketPath, bucket] of this.entries) {
      for (const entry of bucket) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        try {
          entry.client.disconnect();
        } catch (err) {
          console.error(
            "[KairosIPCPool] Failed to disconnect pooled client:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      this.entries.set(socketPath, []);
    }
  }

  /** Current bucket for a socket path; creates one if missing. */
  private getBucket(socketPath: string): PoolEntry[] {
    const existing = this.entries.get(socketPath);
    if (existing) return existing;
    const fresh: PoolEntry[] = [];
    this.entries.set(socketPath, fresh);
    return fresh;
  }

  private markInUse(entry: PoolEntry): void {
    entry.inUse = true;
    entry.lastUsed = Date.now();
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private dropEntry(socketPath: string, entry: PoolEntry): void {
    const bucket = this.entries.get(socketPath);
    if (!bucket) return;
    const idx = bucket.indexOf(entry);
    if (idx !== -1) bucket.splice(idx, 1);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try {
      entry.client.disconnect();
    } catch {
      // Silent: the socket is being discarded anyway and disconnect()
      // failures on an already-broken socket are expected.
    }
  }
}

/** Process-wide shared pool. */
const DEFAULT_POOL = new KairosIPCPool();

/**
 * Run `fn` with a pooled {@link KairosIPCClient}, automatically releasing
 * the connection when `fn` resolves or rejects.
 */
export async function withPooledConnection<T>(
  fn: (client: KairosIPCClient) => Promise<T>,
  socketPath: string = DEFAULT_SOCKET_PATH,
  pool: KairosIPCPool = DEFAULT_POOL,
): Promise<T> {
  const client = await pool.acquire(socketPath);
  try {
    return await fn(client);
  } finally {
    pool.release(client, socketPath);
  }
}

/** Get the default pool. Useful for tests that need to drain. */
export function getDefaultIPCPool(): KairosIPCPool {
  return DEFAULT_POOL;
}
