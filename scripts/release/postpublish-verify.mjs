#!/usr/bin/env node
/**
 * Post-publish verification. Confirms the package actually works
 * end-to-end after `npm publish`. Supports two modes:
 *
 *   1. Default (after publish): hits the registry directly
 *      - `npx wotann@<version> --version` succeeds and matches expected
 *      - `npm view wotann@<version>` reports expected shape
 *
 *   2. --dry-run (before publish): uses a local `npm pack` round-trip
 *      - `npm pack` produces a .tgz
 *      - Install into a scratch temp dir
 *      - Run `node_modules/.bin/wotann --version` from inside the tempdir
 *      - Verify the output matches package.json version
 *      - Never touches the network / registry
 *
 * Exits non-zero on any failure. Prints JSON summary.
 *
 * Usage:
 *   node scripts/release/postpublish-verify.mjs            # live registry check
 *   node scripts/release/postpublish-verify.mjs --dry-run  # local pack+install
 *   node scripts/release/postpublish-verify.mjs 0.4.0      # version override
 *
 * Exit codes:
 *   0 — verification passed
 *   1 — verification failed (version mismatch or install broken)
 *   2 — verifier itself crashed
 */

import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

async function main() {
  // Parse args — --dry-run must be a flag (not a positional), version is positional.
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const explicitVersion = args.find((a) => !a.startsWith("--"));

  const pkgContent = await readFile(resolve(process.cwd(), "package.json"), "utf-8");
  const pkg = JSON.parse(pkgContent);
  const version = explicitVersion ?? pkg.version;
  const pkgName = pkg.name;

  if (dryRun) {
    return runDryRun({ pkg, pkgName, version });
  }
  return runLive({ pkgName, version });
}

// ─── Live mode — hits the real npm registry ────────────────────────
async function runLive({ pkgName, version }) {
  const errors = [];
  const info = { mode: "live" };

  // 1. npx invocation — install latest from registry and run --version.
  try {
    const { stdout } = await execFileAsync(
      "npx",
      [`${pkgName}@${version}`, "--version"],
      { timeout: 120_000 },
    );
    info.npxVersionOutput = stdout.trim();
    if (!stdout.includes(version)) {
      errors.push(
        `npx output (${stdout.trim()}) does not include published version (${version})`,
      );
    }
  } catch (e) {
    errors.push(`npx ${pkgName}@${version} --version failed: ${e.message}`);
  }

  // 2. npm view — confirm registry has the expected package metadata.
  try {
    const { stdout } = await execFileAsync("npm", [
      "view",
      `${pkgName}@${version}`,
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    info.npmView = {
      name: parsed.name,
      version: parsed.version,
      dist: { tarball: parsed.dist?.tarball, shasum: parsed.dist?.shasum },
    };
    if (parsed.name !== pkgName) {
      errors.push(`npm view returned name=${parsed.name}, expected ${pkgName}`);
    }
    if (parsed.version !== version) {
      errors.push(`npm view returned version=${parsed.version}, expected ${version}`);
    }
  } catch (e) {
    errors.push(`npm view ${pkgName}@${version} failed: ${e.message}`);
  }

  report({ pkgName, version, errors, info });
}

// ─── Dry-run mode — local pack+install+exec round-trip ─────────────
async function runDryRun({ pkg, pkgName, version }) {
  const errors = [];
  const info = { mode: "dry-run" };
  let scratch;

  try {
    // 1. Pack the current tree into a .tgz (npm pack reads package.json).
    // `--ignore-scripts` skips the `prepare` hook (which re-runs tsc and
    // can fail on a transient build error unrelated to pack integrity).
    // The dry-run validates the dist/ artifacts already on disk — if they
    // are broken, the install step below will catch it.
    info.step = "npm pack";
    const { stdout: packOut } = await execFileAsync(
      "npm",
      ["pack", "--json", "--ignore-scripts"],
      {
        cwd: process.cwd(),
        timeout: 120_000,
      },
    );
    const packParsed = JSON.parse(packOut);
    const filename = packParsed[0]?.filename;
    if (!filename) {
      errors.push("npm pack --json returned no filename");
      report({ pkgName, version, errors, info });
      return;
    }
    info.tarball = filename;
    const tarballAbs = resolve(process.cwd(), filename);

    // 2. Install the tgz into a scratch directory. `--no-save` avoids
    // touching package.json; `--ignore-scripts` skips post-install hooks
    // to keep the verification deterministic.
    info.step = "scratch install";
    scratch = await mkdtemp(join(tmpdir(), "wotann-postpub-"));
    // Seed a minimal package.json in scratch so npm install works without
    // climbing upward to a random parent dir's workspace config.
    const scratchPkg = {
      name: "wotann-postpub-scratch",
      version: "0.0.0",
      private: true,
      type: "module",
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(scratch, "package.json"),
      JSON.stringify(scratchPkg, null, 2),
    );
    await execFileAsync(
      "npm",
      ["install", "--no-save", "--ignore-scripts", tarballAbs],
      { cwd: scratch, timeout: 240_000 },
    );

    // 3. Run the installed binary. Because `--ignore-scripts` skipped the
    // postinstall rebuild, we expect dist/ to be shipped pre-built inside
    // the .tgz (which the `files` field in package.json already ensures).
    info.step = "bin exec";
    const binPath = join(scratch, "node_modules", ".bin", "wotann");
    const { stdout: versionOut } = await execFileAsync(binPath, ["--version"], {
      cwd: scratch,
      timeout: 30_000,
    });
    info.installedVersion = versionOut.trim();
    if (!versionOut.includes(version)) {
      errors.push(
        `installed wotann --version output (${versionOut.trim()}) does not contain expected version (${version})`,
      );
    }

    // 4. Cleanup the local .tgz — we don't want it littering the repo.
    try {
      await rm(tarballAbs);
    } catch {
      // Non-fatal.
    }
  } catch (e) {
    errors.push(
      `dry-run failed at step '${info.step ?? "?"}': ${e.message}${e.stderr ? `\nstderr: ${e.stderr}` : ""}`,
    );
  } finally {
    if (scratch) {
      try {
        await rm(scratch, { recursive: true, force: true });
      } catch {
        // Non-fatal.
      }
    }
  }

  report({ pkgName, version, errors, info });
}

function report({ pkgName, version, errors, info }) {
  const summary = {
    ok: errors.length === 0,
    pkgName,
    version,
    errors,
    info,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      ok: false,
      fatal: true,
      message: `post-publish verify crashed: ${e.message}`,
      stack: e.stack,
    }),
  );
  process.exit(2);
});
