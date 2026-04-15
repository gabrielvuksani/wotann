#!/usr/bin/env node
/**
 * Daemon entry point — starts KAIROS daemon as a standalone process.
 * Used by the Tauri sidecar to spawn the daemon.
 *
 * Usage: node dist/daemon/start.js
 */

import { KairosDaemon } from "./kairos.js";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { ensureAllSidecars } from "../utils/sidecar-downloader.js";

const wotannDir = join(homedir(), ".wotann");
if (!existsSync(wotannDir)) {
  mkdirSync(wotannDir, { recursive: true });
}

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
    return true;
  } catch (err) {
    // Opus audit (2026-04-15): prior catch{} treated EPERM (alive but
    // not ours) as dead, which on multi-tenant hosts let two daemons
    // race for the same socket/port. Now: EPERM means alive (return
    // true), ESRCH means dead (return false), anything else: be safe
    // and assume alive (better to refuse start than collide).
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return false;
    return true;
  }
}

/**
 * Write a file atomically via tmp + rename. POSIX rename is atomic on
 * the same filesystem, so two concurrent daemon-start invocations either
 * both succeed in writing their own tmp file but only one wins the
 * rename, or one wins and the other fails the rename — never partial.
 *
 * Closes the "PID write non-atomic" Opus audit finding: previously
 * `writeFileSync(pidPath, ...)` could be observed mid-write by a
 * concurrent reader, and two writers would clobber each other.
 */
function atomicWrite(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, content);
  // O_EXCL-style: if the target was created by another process between
  // our existsSync check and now, the rename still atomically replaces
  // it. We accept "last writer wins" semantics — the alternative
  // (bail-out via O_EXCL) would race with stale-cleanup paths.
  renameSync(tmpPath, targetPath);
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

writeFileSync(
  statusPath,
  JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "starting",
  }),
);

const daemon = new KairosDaemon();

// Graceful shutdown handlers
function cleanupOnExit() {
  try {
    unlinkSync(pidPath);
  } catch {
    /* already removed */
  }
  writeFileSync(statusPath, JSON.stringify({ pid: process.pid, status: "stopped" }));
}

process.on("SIGTERM", async () => {
  console.log("[KAIROS] SIGTERM received, shutting down...");
  daemon.stop();
  cleanupOnExit();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[KAIROS] SIGINT received, shutting down...");
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
  writeFileSync(
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
  writeFileSync(
    statusPath,
    JSON.stringify({
      pid: process.pid,
      status: "failed",
      error: String(err),
    }),
  );
  process.exit(1);
}
