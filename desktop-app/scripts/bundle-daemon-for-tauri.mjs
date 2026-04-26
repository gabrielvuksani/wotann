#!/usr/bin/env node
/**
 * bundle-daemon-for-tauri.mjs — SB-N3 fix.
 *
 * Copies the compiled WOTANN daemon (dist/) into a path Tauri's bundler
 * can pick up via `bundle.resources`. Without this step the .dmg ships
 * a desktop GUI that cannot find the KAIROS daemon — sidecar.rs fails
 * with "WOTANN source not found" because no developer checkout exists
 * on the end-user's machine.
 *
 * Source: <repo>/dist/                        (cwd-relative — assumes run from desktop-app/)
 * Target: <repo>/desktop-app/src-tauri/wotann-runtime/
 *
 * Triggered by `desktop-app/src-tauri/tauri.conf.json.beforeBuildCommand`.
 * Idempotent: the target dir is wiped and repopulated on every run so a
 * stale dist/ never lingers across builds.
 *
 * Honest failure model (QB#10): exits non-zero when prerequisites are
 * missing so a partial bundle never reaches the .dmg.
 */
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP_APP_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(DESKTOP_APP_DIR, "..");
const SRC_DIST = join(REPO_ROOT, "dist");
const SRC_PACKAGE_JSON = join(REPO_ROOT, "package.json");
const TARGET_DIR = join(DESKTOP_APP_DIR, "src-tauri", "wotann-runtime");

if (!existsSync(SRC_DIST)) {
  console.error(
    `[bundle-daemon-for-tauri] FATAL: ${SRC_DIST} does not exist.\n` +
      `Run \`npm run build\` at the repo root before building the desktop app.`,
  );
  process.exit(1);
}
if (!existsSync(join(SRC_DIST, "daemon", "start.js"))) {
  console.error(
    `[bundle-daemon-for-tauri] FATAL: dist/daemon/start.js missing.\n` +
      `The daemon build is incomplete. Run \`npm run build\` at the repo root first.`,
  );
  process.exit(1);
}

console.log(`[bundle-daemon-for-tauri] copying ${SRC_DIST} -> ${TARGET_DIR}`);
if (existsSync(TARGET_DIR)) rmSync(TARGET_DIR, { recursive: true, force: true });
mkdirSync(TARGET_DIR, { recursive: true });

// Copy dist/ tree
cpSync(SRC_DIST, join(TARGET_DIR, "dist"), { recursive: true });

// Copy a slimmed package.json so node module resolution works at runtime.
const pkg = JSON.parse(readFileSync(SRC_PACKAGE_JSON, "utf-8"));
const slim = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  main: "dist/index.js",
  bin: pkg.bin,
  dependencies: pkg.dependencies,
};
writeFileSync(join(TARGET_DIR, "package.json"), JSON.stringify(slim, null, 2));

console.log(`[bundle-daemon-for-tauri] OK — bundled daemon ready for Tauri resources.`);
