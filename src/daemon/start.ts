#!/usr/bin/env node
/**
 * Daemon entry point — starts KAIROS daemon as a standalone process.
 * Used by the Tauri sidecar to spawn the daemon.
 *
 * Usage: node dist/daemon/start.js
 */

import { KairosDaemon } from "./kairos.js";
import { join } from "node:path";
import { readFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync } from "node:fs";
import { ensureAllSidecars } from "../utils/sidecar-downloader.js";
import { resolveWotannHome } from "../utils/wotann-home.js";
import { installProcessHandlers } from "../utils/process-handlers.js";
import { writeFileAtomic } from "../utils/atomic-io.js";

const wotannDir = resolveWotannHome();
if (!existsSync(wotannDir)) {
  mkdirSync(wotannDir, { recursive: true });
}

// V9 Wave 6-RR (SB-9): install uncaughtException + unhandledRejection
// handlers in the DAEMON worker entry. The daemon is a long-running
// process — without these handlers a single unhandled rejection in any
// codepath (cron tick, IPC handler, channel adapter) silently kills the
// daemon under Node ≥15 default with no log entry. We append to the
// daily JSONL log via direct appendFileSync rather than holding a
// reference to KairosDaemon's appendLog (the daemon may not yet be
// constructed when an early-boot fault fires).
const daemonLogDir = join(wotannDir, "logs");
if (!existsSync(daemonLogDir)) {
  try {
    mkdirSync(daemonLogDir, { recursive: true });
  } catch {
    // Best-effort: handlers will still write to stderr.
  }
}
installProcessHandlers({
  tag: "kairos-daemon",
  appendLog: (entry) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const logFile = join(daemonLogDir, `${today}.jsonl`);
      const line =
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ...entry,
        }) + "\n";
      appendFileSync(logFile, line);
    } catch {
      // stderr line was already emitted by installProcessHandlers.
    }
  },
});

/**
 * Load ~/.wotann/providers.env into process.env BEFORE the daemon constructs
 * its provider registry. Parses KEY=VALUE lines, supports quoted values, and
 * never overwrites existing env vars (user shell takes precedence).
 *
 * This is the critical path for the "Configure API key → Save → Models appear"
 * flow: ProviderConfig.tsx writes keys here via save_api_keys, and the daemon
 * must see them on startup so discovery succeeds on first probe.
 */
function loadProvidersEnv(): void {
  const providersEnvPath = join(wotannDir, "providers.env");
  if (!existsSync(providersEnvPath)) {
    return; // Missing file is fine — user may not have configured keys yet
  }
  try {
    const content = readFileSync(providersEnvPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) {
        console.warn(`[KAIROS] providers.env: skipping malformed line: ${line.slice(0, 40)}`);
        continue;
      }
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      // Strip surrounding quotes (single or double)
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn(
      `[KAIROS] providers.env: failed to load (continuing): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

loadProvidersEnv();

// S2-30: PID + status-file management with liveness verification.
//
// Previously we wrote the new daemon's PID on top of any stale pid file,
// and published `status: "starting"` atomically — that caused two
// problems: (a) an old pid-file from a crashed daemon looked alive; and
// (b) the status briefly reported "starting" even when the daemon
// already was reachable on a port. Now:
//   1. If a pid file exists, verify the process is alive via kill(pid, 0).
//      If it's dead, silently remove the stale file. If alive, bail out
//      with an informative error so we don't start a second daemon.
//   2. Only write `status: "running"` after `daemon.start()` resolves
//      successfully (handled below in the try block). The "starting"
//      status is still useful for external monitors that want to see
//      the transitional state.
const pidPath = join(wotannDir, "daemon.pid");
const statusPath = join(wotannDir, "daemon.status.json");

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // `kill(pid, 0)` doesn't send a signal — it just tests for existence
    // + permission. Throws ESRCH if the process is gone, EPERM if the
    // PID is owned by another user (which means it IS alive).
    process.kill(pid, 0);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return false;
    // EPERM + other errors fall through to the cmdline check — the PID
    // exists at the kernel level, but macOS recycles PIDs aggressively
    // so we must confirm it's actually our daemon before claiming
    // "already running" and bailing the new spawn.
  }
  // Verify the PID owner is actually a node daemon, not a recycled PID
  // belonging to an unrelated process (SSH session, kernel task, etc).
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // Match "node" + "daemon|wotann" in any order — covers both
    // `tsx src/daemon/start.ts` and `node dist/daemon/start.js`.
    return /node.*(daemon|wotann)|wotann.*daemon/i.test(cmd);
  } catch {
    // `ps` couldn't find the PID → recycled or gone. Let the caller
    // treat the pid file as stale and clean it up rather than refusing
    // to start forever.
    return false;
  }
}

/**
 * Write a file atomically via the shared utils/atomic-io helper. Wave 6.5-UU
 * (H-22) consolidated the per-site atomic-write code into one fsync-aware
 * implementation; this kept-alive shim preserves the local function name so
 * existing call sites inside this module don't churn.
 *
 * Closes the "PID write non-atomic" Opus audit finding: previously
 * `writeFileSync(pidPath, ...)` could be observed mid-write by a
 * concurrent reader, and two writers would clobber each other.
 */
function atomicWrite(targetPath: string, content: string): void {
  writeFileAtomic(targetPath, content);
}

if (existsSync(pidPath)) {
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    const existing = parseInt(raw, 10);
    if (isProcessAlive(existing) && existing !== process.pid) {
      console.error(
        `[KAIROS] Daemon already running (PID ${existing}). ` +
          `Use 'wotann daemon stop' first, or delete ${pidPath} if the PID is a leftover.`,
      );
      process.exit(1);
    }
    // Stale pid file — clean up before we write our own.
    try {
      unlinkSync(pidPath);
    } catch {
      /* best-effort: we'll overwrite below anyway */
    }
  } catch {
    // Unreadable pid file — treat as stale.
  }
}

atomicWrite(pidPath, String(process.pid));

// Wave 6.5-UU (H-22) — daemon status file is read by Tauri sidecar +
// `wotann daemon status`. Atomic write prevents readers from seeing a
// half-written status JSON during a crash window.
atomicWrite(
  statusPath,
  JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "starting",
  }),
);

// V9 Wave 6.7 (M-N6) — SIGINT dedupe. start.ts owns the signal handlers
// because it's the only entry point that knows about pidPath and
// statusPath. Setting this env var BEFORE constructing the daemon tells
// KairosDaemon.start() to SKIP its own installShutdownHandlers(), so the
// process never has two competing SIGINT chains that could call stop()
// twice (the second call is a no-op via the `status === "stopped"`
// guard, but the duplicate listener registration would still leak across
// `daemon.stop()` -> `daemon.start()` cycles in tests).
process.env["WOTANN_DAEMON_OWNS_SIGNALS"] = "1";

const daemon = new KairosDaemon();

// Graceful shutdown handlers
function cleanupOnExit() {
  try {
    unlinkSync(pidPath);
  } catch {
    /* already removed */
  }
  atomicWrite(statusPath, JSON.stringify({ pid: process.pid, status: "stopped" }));
}

// Forced-exit watchdog: if `daemon.stop()` hangs (stuck cron task,
// deadlocked socket close, worker waiting on a syscall), the process
// can otherwise only be killed by an external SIGKILL. After
// SHUTDOWN_DEADLINE_MS we force `process.exit(2)` regardless. Mirrors
// home-assistant/core's `THREADING_SHUTDOWN_TIMEOUT` pattern (audit
// finding).
const SHUTDOWN_DEADLINE_MS = 15_000;
function armShutdownWatchdog(reason: string): void {
  setTimeout(() => {
    console.error(
      `[KAIROS] Shutdown deadline (${SHUTDOWN_DEADLINE_MS}ms) reached after ${reason} — forcing exit(2).`,
    );
    process.exit(2);
  }, SHUTDOWN_DEADLINE_MS).unref();
}

process.on("SIGTERM", async () => {
  console.log("[KAIROS] SIGTERM received, shutting down...");
  armShutdownWatchdog("SIGTERM");
  daemon.stop();
  cleanupOnExit();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[KAIROS] SIGINT received, shutting down...");
  armShutdownWatchdog("SIGINT");
  daemon.stop();
  cleanupOnExit();
  process.exit(0);
});

// Ensure sidecar binaries (Ollama, Whisper) are present + verified before
// the daemon starts so first-use does not block on a multi-megabyte download.
try {
  await ensureAllSidecars();
} catch (err) {
  console.warn("[KAIROS] Sidecar check failed (continuing):", err);
}

// Start the daemon
try {
  await daemon.start();
  atomicWrite(
    statusPath,
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      status: "running",
    }),
  );
  console.log(`[KAIROS] Daemon running (PID: ${process.pid})`);
} catch (err) {
  console.error("[KAIROS] Failed to start:", err);
  atomicWrite(
    statusPath,
    JSON.stringify({
      pid: process.pid,
      status: "failed",
      error: String(err),
    }),
  );
  process.exit(1);
}
