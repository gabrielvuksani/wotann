#!/usr/bin/env node
/**
 * Post-publish verification. Run AFTER `npm publish` to confirm the
 * package actually works end-to-end from the registry:
 *   1. `npx wotann@<version> --version` succeeds
 *   2. The version in the output matches the published version
 *   3. `npm view wotann@<version>` reports the expected shape
 *
 * Exits non-zero on any failure. Prints JSON summary.
 *
 * Usage: node scripts/release/postpublish-verify.mjs [version]
 *        (version defaults to the one in package.json)
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

async function main() {
  const pkgContent = await readFile(resolve(process.cwd(), "package.json"), "utf-8");
  const pkg = JSON.parse(pkgContent);
  const version = process.argv[2] ?? pkg.version;
  const pkgName = pkg.name;

  const errors = [];
  const info = {};

  // 1. npx invocation
  try {
    const { stdout } = await execFileAsync(
      "npx",
      [`${pkgName}@${version}`, "--version"],
      { timeout: 60_000 },
    );
    info.npxVersionOutput = stdout.trim();
    // 2. version matches
    if (!stdout.includes(version)) {
      errors.push(
        `npx output (${stdout.trim()}) does not include published version (${version})`,
      );
    }
  } catch (e) {
    errors.push(`npx ${pkgName}@${version} --version failed: ${e.message}`);
  }

  // 3. npm view
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
  console.error("post-publish verify crashed:", e.message);
  process.exit(2);
});
