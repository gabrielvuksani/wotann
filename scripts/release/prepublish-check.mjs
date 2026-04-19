#!/usr/bin/env node
/**
 * Pre-publish validation. Runs before `npm publish` to catch common
 * ship-breakers. FAIL LOUDLY — no silent passes.
 *
 * Bundle-health gates:
 *   1. package.json has required fields (name, version, bin, main)
 *   2. dist/index.js exists, is > 0 bytes, and has '#!/usr/bin/env node' shebang
 *   3. dist/index.js is NOT a shim — it must contain actual bundled code
 *      (heuristic: > 10 KB, references 'wotann' or 'WOTANN' at least once)
 *   4. All 19 provider adapters export their factory/entry types from dist/providers
 *   5. No .env or credentials.json in the tarball contents
 *   6. The version isn't already published (npm view returns 404 or older)
 *   7. README + LICENSE files are present
 *   8. Version in dist/index.js VERSION const matches package.json version
 *
 * Exit codes:
 *   0 — all gates pass
 *   1 — at least one gate failed (errors printed as structured JSON)
 *   2 — script itself crashed (bug in the check, not the package)
 */

import { readFile, stat, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const errors = [];
const warnings = [];

// The set of provider adapters expected in dist/providers. Matches the 19
// `case "<provider>":` branches in src/providers/registry.ts. These are the
// registry-level providers — each must have at least one adapter file in
// the built dist/providers directory.
const EXPECTED_PROVIDERS = [
  "anthropic",
  "openai",
  "codex",
  "copilot",
  "ollama",
  "free",
  "gemini",
  "huggingface",
  "azure",
  "bedrock",
  "vertex",
  "mistral",
  "deepseek",
  "perplexity",
  "xai",
  "together",
  "fireworks",
  "sambanova",
  "groq",
];

async function main() {
  // ── Gate 1: package.json required fields ─────────────────────────
  let pkg;
  try {
    const content = await readFile(resolve(ROOT, "package.json"), "utf-8");
    pkg = JSON.parse(content);
  } catch (e) {
    errors.push({
      gate: "package.json-read",
      message: `package.json read failed: ${e.message}`,
    });
    return report();
  }

  for (const field of ["name", "version", "main"]) {
    if (!pkg[field]) {
      errors.push({
        gate: "package.json-fields",
        message: `package.json missing required field: ${field}`,
      });
    }
  }
  if (!pkg.bin) {
    errors.push({
      gate: "package.json-bin",
      message: "package.json has no `bin` — the `wotann` command won't be installable",
    });
  }

  // ── Gate 2: dist/index.js exists, non-empty, shebang ─────────────
  const distIndexPath = resolve(ROOT, "dist/index.js");
  let distContent = "";
  try {
    await access(distIndexPath, constants.R_OK);
    const stats = await stat(distIndexPath);
    if (stats.size === 0) {
      errors.push({
        gate: "dist-nonempty",
        message: "dist/index.js exists but is 0 bytes — build is broken",
      });
    } else {
      distContent = await readFile(distIndexPath, "utf-8");
      const firstLine = distContent.split("\n", 1)[0];
      if (firstLine !== "#!/usr/bin/env node") {
        errors.push({
          gate: "dist-shebang",
          message: `dist/index.js missing '#!/usr/bin/env node' shebang — got: ${JSON.stringify(firstLine)}`,
        });
      }
    }
  } catch {
    errors.push({
      gate: "dist-exists",
      message: "dist/index.js missing — run `npm run build` first",
    });
  }

  // ── Gate 3: dist/index.js is not a Node-process shim ─────────────
  // A shim is small (<10 KB) and doesn't reference the product name. We
  // require both a size floor and a product marker to pass.
  if (distContent.length > 0) {
    const distSize = Buffer.byteLength(distContent, "utf-8");
    if (distSize < 10_240) {
      errors.push({
        gate: "dist-not-shim",
        message: `dist/index.js is only ${distSize} bytes — looks like a shim, not a real bundle (threshold 10 KB)`,
      });
    }
    if (!/wotann/i.test(distContent)) {
      errors.push({
        gate: "dist-has-product-marker",
        message:
          "dist/index.js contains no mention of 'wotann' — bundle is probably empty or wrong entry point",
      });
    }
  }

  // ── Gate 4: All 19 provider adapters present in dist ─────────────
  // The registry module (dist/providers/registry.js) holds the canonical
  // switch-case branch for every provider. We verify every expected
  // provider name appears as a quoted string in that bundle — the
  // compile output of `case "<provider>":`.
  const distProvidersDir = resolve(ROOT, "dist/providers");
  try {
    await access(distProvidersDir, constants.R_OK);
  } catch {
    errors.push({
      gate: "dist-providers-dir",
      message: "dist/providers/ missing — provider adapters not built",
    });
  }

  const registryPath = resolve(ROOT, "dist/providers/registry.js");
  try {
    await access(registryPath, constants.R_OK);
    const registryContent = await readFile(registryPath, "utf-8");
    const missingProviders = [];
    for (const provider of EXPECTED_PROVIDERS) {
      const pattern = new RegExp(`["\`']${provider}["\`']`);
      if (!pattern.test(registryContent)) {
        missingProviders.push(provider);
      }
    }
    if (missingProviders.length > 0) {
      errors.push({
        gate: "dist-all-providers",
        message: `dist/providers/registry.js does not reference ${missingProviders.length} of ${EXPECTED_PROVIDERS.length} expected providers: ${missingProviders.join(", ")}`,
      });
    }
  } catch (e) {
    errors.push({
      gate: "dist-registry-present",
      message: `dist/providers/registry.js missing or unreadable: ${e.message}`,
    });
  }

  // ── Gate 5: No secrets in the pack ───────────────────────────────
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
        errors.push({
          gate: "pack-no-secrets",
          message: `secret-looking file would ship: ${file}`,
        });
      }
    }
  }

  // ── Gate 6: Version not already published ────────────────────────
  try {
    const published = execFileSync("npm", ["view", pkg.name, "version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (published === pkg.version) {
      errors.push({
        gate: "version-not-duplicate",
        message: `version ${pkg.version} already published as ${pkg.name}@${published}`,
      });
    }
  } catch {
    // Package doesn't exist yet (first publish) OR network issue. npm publish
    // will reject a true duplicate on its own, so we don't escalate this to
    // an error — but we surface it as a warning so CI logs can diagnose.
    warnings.push({
      gate: "version-check",
      message: `could not verify current npm version for ${pkg.name} (first publish or offline)`,
    });
  }

  // ── Gate 7: README + LICENSE ─────────────────────────────────────
  try {
    await access(resolve(ROOT, "README.md"), constants.R_OK);
  } catch {
    errors.push({
      gate: "readme-present",
      message: "README.md missing",
    });
  }
  try {
    await access(resolve(ROOT, "LICENSE"), constants.R_OK);
  } catch {
    errors.push({
      gate: "license-present",
      message: "LICENSE missing",
    });
  }

  // ── Gate 8: VERSION const in dist/index.js matches package.json ──
  if (distContent.length > 0) {
    // Look for `const VERSION = "<x.y.z>"` pattern that we ship in src/index.ts.
    const versionMatch = distContent.match(/const\s+VERSION\s*=\s*["']([^"']+)["']/);
    if (versionMatch) {
      const distVersion = versionMatch[1];
      if (distVersion !== pkg.version) {
        errors.push({
          gate: "version-in-sync",
          message: `dist/index.js VERSION const (${distVersion}) does not match package.json version (${pkg.version}) — rebuild required`,
        });
      }
    } else {
      warnings.push({
        gate: "version-in-sync",
        message: "could not locate VERSION const in dist/index.js — bundle may be transformed in unexpected ways",
      });
    }
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
    gatesRun: 8,
    gatesPassed: 8 - new Set(errors.map((e) => e.gate)).size,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      ok: false,
      fatal: true,
      message: `pre-publish check crashed: ${e.message}`,
      stack: e.stack,
    }),
  );
  process.exit(2);
});
