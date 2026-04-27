#!/usr/bin/env node
/**
 * bundle-daemon-for-tauri.mjs — SB-N3 fix + Gap-3 fix (Tauri DMG completeness).
 *
 * Copies the compiled WOTANN daemon (dist/) AND its production node_modules
 * into a path Tauri's bundler can pick up via `bundle.resources`. Without
 * BOTH steps the .dmg ships a desktop GUI that cannot start the KAIROS
 * daemon — either sidecar.rs fails with "WOTANN source not found" (no
 * dist/) or the daemon throws "Cannot find module 'better-sqlite3'" at
 * first import (no node_modules/).
 *
 * Source:
 *   <repo>/dist/         — compiled daemon JS
 *   <repo>/package.json  — dependency list
 *
 * Target:
 *   <repo>/desktop-app/src-tauri/wotann-runtime/
 *     dist/                — copied as-is
 *     package.json         — slimmed (deps only)
 *     node_modules/        — installed via `npm install --omit=dev`
 *
 * Triggered by `desktop-app/src-tauri/tauri.conf.json.beforeBuildCommand`.
 * Idempotent: the target dir is wiped and repopulated on every run so a
 * stale dist/ or stale node_modules never lingers across builds.
 *
 * Honest failure model (QB#10): exits non-zero when prerequisites are
 * missing OR when npm install fails, so a partial bundle never reaches
 * the .dmg. The end-user still needs system Node.js installed (Tauri's
 * sidecar.rs spawns `node` from PATH); install_node helper in
 * commands.rs:2136 walks them through Homebrew install if missing.
 */
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP_APP_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(DESKTOP_APP_DIR, "..");
const SRC_DIST = join(REPO_ROOT, "dist");
const SRC_PACKAGE_JSON = join(REPO_ROOT, "package.json");
const SRC_LOCKFILE = join(REPO_ROOT, "package-lock.json");
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

// Write a slimmed package.json so npm install (next step) only pulls
// production dependencies; devDependencies (vitest, eslint, etc.) are
// excluded which keeps the bundled node_modules under ~150 MB instead
// of the full 645 MB checkout.
const pkg = JSON.parse(readFileSync(SRC_PACKAGE_JSON, "utf-8"));
const slim = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  main: "dist/index.js",
  bin: pkg.bin,
  dependencies: pkg.dependencies,
  // overrides (npm transitive-deps pinning) is required for production
  // bundles too — strips out the broken brace-expansion 5.0.5 we work
  // around in CI. Without copying overrides the bundled install would
  // pull the broken transitive again.
  ...(pkg.overrides ? { overrides: pkg.overrides } : {}),
};
writeFileSync(join(TARGET_DIR, "package.json"), JSON.stringify(slim, null, 2));

// Copy lockfile so `npm install` resolves to the exact versions used at
// build time. Skip silently if the lockfile is absent (first-time clone
// or workspace mode) — npm will fall back to range resolution.
if (existsSync(SRC_LOCKFILE)) {
  cpSync(SRC_LOCKFILE, join(TARGET_DIR, "package-lock.json"));
}

// Gap-3 fix: install production dependencies into the bundle so the
// daemon can resolve `import { Database } from 'better-sqlite3'` and
// every other dep at runtime. Prior bundle script only wrote the
// slimmed package.json without ever running an install — the .dmg
// shipped with `dependencies` listed but no node_modules to satisfy
// them, and the daemon crashed on first require.
console.log(`[bundle-daemon-for-tauri] installing production deps into ${TARGET_DIR}`);
const npmResult = spawnSync(
  "npm",
  // --omit=dev: skip vitest/eslint/etc. (~500 MB savings)
  // --no-audit --no-fund: silence non-critical network calls
  // --ignore-scripts: skip postinstall hooks (we already built dist/)
  // --no-save: don't mutate the slimmed package.json
  ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-save"],
  { cwd: TARGET_DIR, stdio: "inherit", shell: true },
);
if (npmResult.status !== 0) {
  console.error(
    `[bundle-daemon-for-tauri] FATAL: production npm install failed in ${TARGET_DIR}.\n` +
      `The .dmg would ship without node_modules — daemon cannot start. Aborting.`,
  );
  process.exit(npmResult.status ?? 1);
}

console.log(`[bundle-daemon-for-tauri] OK — bundled daemon + node_modules ready for Tauri resources.`);
