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
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
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

// Write PID file for process management
const pidPath = join(wotannDir, "daemon.pid");
writeFileSync(pidPath, String(process.pid));

// Write status file
const statusPath = join(wotannDir, "daemon.status.json");
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
