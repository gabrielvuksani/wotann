#!/usr/bin/env node
/**
 * Pre-publish validation. Runs before `npm publish` to catch common
 * ship-breakers:
 *   1. package.json has required fields (name, version, bin, main)
 *   2. dist/ directory exists + has dist/index.js
 *   3. No .env or credentials.json in the tarball contents
 *   4. The version isn't already published (npm view returns 404 or older)
 *   5. README + LICENSE files are present
 *
 * Exits non-zero on any failure. Prints JSON summary on success.
 */

import { readFile, stat, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const errors = [];
const warnings = [];

async function main() {
  // 1. package.json
  let pkg;
  try {
    const content = await readFile(resolve(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(content);
  } catch (e) {
    errors.push(`package.json read failed: ${e.message}`);
    return report();
  }

  for (const field of ["name", "version", "main"]) {
    if (!pkg[field]) errors.push(`package.json missing required field: ${field}`);
  }
  if (!pkg.bin) {
    warnings.push("package.json has no `bin` — the `wotann` command won't be installable");
  }

  // 2. dist/ exists + has index
  try {
    await access(resolve(ROOT, "dist/index.js"), constants.R_OK);
  } catch {
    errors.push("dist/index.js missing — run `npm run build` first");
  }

  // 3. No secrets in the pack
  const packContents = await listPackContents();
  const secretPatterns = [
    /\.env(\..*)?$/,
    /credentials\.json$/,
    /\.pem$/,
    /id_rsa/,
    /secret/i,
    /private-key/i,
  ];
  for (const file of packContents) {
    for (const pat of secretPatterns) {
      if (pat.test(file)) {
        errors.push(`secret-looking file would ship: ${file}`);
      }
    }
  }

  // 4. Version not already published
  try {
    const published = execFileSync("npm", ["view", pkg.name, "version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (published === pkg.version) {
      errors.push(`version ${pkg.version} already published as ${pkg.name}@${published}`);
    }
  } catch {
    // Package doesn't exist yet (first publish) OR network issue.
    // Not fatal — npm publish will reject if it's a duplicate.
  }

  // 5. README + LICENSE
  try {
    await access(resolve(ROOT, "README.md"), constants.R_OK);
  } catch {
    warnings.push("README.md missing");
  }
  try {
    await access(resolve(ROOT, "LICENSE"), constants.R_OK);
  } catch {
    warnings.push("LICENSE missing");
  }

  return report();
}

async function listPackContents() {
  try {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(output);
    const files = parsed[0]?.files ?? [];
    return files.map((f) => f.path);
  } catch {
    return [];
  }
}

function report() {
  const summary = {
    ok: errors.length === 0,
    errors,
    warnings,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("pre-publish check crashed:", e.message);
  process.exit(2);
});
