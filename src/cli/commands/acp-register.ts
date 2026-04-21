/**
 * `wotann acp register` — publish WOTANN's agent.json to the Zed/JetBrains/Air ACP registry.
 *
 * Pure handler (no commander/process-exit inside) so tests can drive it
 * with structured options and assert on the returned `AcpRegisterResult`.
 * The CLI entry in src/index.ts pipes options into this function and
 * prints the returned `lines`.
 *
 * Behaviour summary:
 *   - Default: build manifest, validate, write locally at
 *     `<cwd>/wotann-acp/agent.json`, print submission URL for manual PR.
 *   - `--registry-url X [--registry-token T]`: also POST the manifest.
 *     Network failures fall back to local-only (with the URL still set
 *     on the result so the caller can retry).
 *   - `--dry-run`: build + validate + print, but do NOT touch disk or
 *     network. Used for previewing the output in CI.
 *   - `--manifest-out PATH`: override the output path.
 *   - `--package-json PATH`: override the package.json to read. Defaults
 *     to `<cwd>/package.json` which is the WOTANN repo root itself.
 *
 * Per-session state (QB #7): a fresh result object is built every call;
 * nothing is cached across invocations.
 */

import { resolve } from "node:path";
import { buildManifest, BuildManifestError } from "../../acp/manifest.js";
import type { AcpRegistryManifest } from "../../acp/manifest.js";
import {
  registerWithZed,
  REGISTRY_MANUAL_SUBMIT_URL,
  type RegisterResult,
} from "../../acp/registry.js";

// Options ────────────────────────────────────────────────────

export interface AcpRegisterOptions {
  /** Defaults to the current working directory. */
  readonly cwd?: string;
  /** Overrides the default `<cwd>/package.json`. */
  readonly packageJsonPath?: string;
  /** Overrides the default `<cwd>/wotann-acp/agent.json`. */
  readonly manifestOut?: string;
  /** Registry endpoint to POST to. When absent we write local-only. */
  readonly registryUrl?: string;
  /** Bearer token for the registry. Ignored unless `registryUrl` is set. */
  readonly registryToken?: string;
  /** Skip network + disk writes entirely — just print what we'd build. */
  readonly dryRun?: boolean;
  /** Override manifest id (defaults to kebab-case of package name). */
  readonly id?: string;
  /** Override description. */
  readonly description?: string;
  /** Tool names to advertise under `capabilities.tools`. */
  readonly tools?: readonly string[];
  /** Provider names to advertise under `capabilities.models`. */
  readonly models?: readonly string[];
  /** Programming languages WOTANN supports first-class. */
  readonly languages?: readonly string[];
  /** Icon URL. */
  readonly icon?: string;
  /**
   * Test injection for the network POST. Omit in production (global
   * `fetch` is used). SSRF is still enforced so this can't bypass it.
   */
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

// Return shape ──────────────────────────────────────────────

export interface AcpRegisterResult {
  readonly success: boolean;
  readonly manifest?: AcpRegistryManifest;
  readonly result?: RegisterResult;
  readonly lines: readonly string[];
  readonly error?: string;
}

// Entry ──────────────────────────────────────────────────────

/**
 * Run `wotann acp register`. Returns a structured result; never throws
 * for expected failure modes (bad package.json, network down, etc.) —
 * callers inspect `success` and either exit 0 or 1 accordingly.
 *
 * Unexpected errors (e.g. OS signals) propagate — only predictable
 * domain failures collapse into `success: false`.
 */
export async function runAcpRegisterCommand(
  options: AcpRegisterOptions = {},
): Promise<AcpRegisterResult> {
  const cwd = options.cwd ?? process.cwd();
  const packageJsonPath = options.packageJsonPath ?? resolve(cwd, "package.json");
  const manifestOut = options.manifestOut ?? resolve(cwd, "wotann-acp", "agent.json");

  // 1. Build manifest ────────────────────────────────────────
  let manifest: AcpRegistryManifest;
  try {
    manifest = buildManifest({
      packageJsonPath,
      ...(options.id !== undefined ? { id: options.id } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.models !== undefined ? { models: options.models } : {}),
      ...(options.languages !== undefined ? { languages: options.languages } : {}),
      ...(options.icon !== undefined ? { icon: options.icon } : {}),
    });
  } catch (err) {
    const message =
      err instanceof BuildManifestError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      success: false,
      lines: [
        `[acp-register] Manifest build failed: ${message}`,
        `[acp-register] Check ${packageJsonPath}`,
      ],
      error: message,
    };
  }

  // 2. Submit / write ────────────────────────────────────────
  const result = await registerWithZed(manifest, {
    manifestOutPath: manifestOut,
    ...(options.registryUrl !== undefined ? { registryUrl: options.registryUrl } : {}),
    ...(options.registryToken !== undefined ? { registryToken: options.registryToken } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  // 3. Compose human-readable lines ──────────────────────────
  const lines: string[] = [];
  lines.push("");
  lines.push("wotann acp register");
  lines.push("");
  lines.push(`  id:          ${manifest.id}`);
  lines.push(`  name:        ${manifest.name}`);
  lines.push(`  version:     ${manifest.version}`);
  lines.push(`  description: ${manifest.description}`);

  switch (result.status) {
    case "SUBMITTED":
      lines.push(`  status:      SUBMITTED to ${result.registryUrl ?? ""}`);
      if (result.manifestPath) {
        lines.push(`  local copy:  ${result.manifestPath}`);
      }
      break;
    case "LOCAL-ONLY":
      if (result.registryUrl) {
        lines.push(
          `  status:      LOCAL-ONLY (registry POST failed: ${result.reason ?? "no detail"})`,
        );
      } else if (options.dryRun === true) {
        lines.push(`  status:      DRY-RUN — no files or network touched`);
      } else {
        lines.push(`  status:      LOCAL-ONLY — no --registry-url given`);
      }
      if (result.manifestPath) {
        lines.push(`  local copy:  ${result.manifestPath}`);
      }
      lines.push(`  manual PR:   ${result.manualSubmitUrl}`);
      break;
    case "VALIDATION-FAILED":
      lines.push(`  status:      VALIDATION-FAILED`);
      for (const err of result.validationErrors ?? []) {
        lines.push(`    - ${err}`);
      }
      break;
    case "BLOCKED-URL":
      lines.push(`  status:      BLOCKED-URL (${result.reason ?? "SSRF guard rejected URL"})`);
      if (result.manifestPath) {
        lines.push(`  local copy:  ${result.manifestPath}`);
      }
      lines.push(`  manual PR:   ${result.manualSubmitUrl}`);
      break;
  }

  for (const warning of result.validationWarnings) {
    lines.push(`  warning:     ${warning}`);
  }

  lines.push("");
  if (result.status === "LOCAL-ONLY" || result.status === "BLOCKED-URL") {
    lines.push(
      `  Next steps: open ${REGISTRY_MANUAL_SUBMIT_URL} and PR ${manifest.id}/agent.json into the registry.`,
    );
    lines.push("");
  }

  const success =
    result.status === "SUBMITTED" ||
    (result.status === "LOCAL-ONLY" && options.dryRun === true) ||
    (result.status === "LOCAL-ONLY" && options.registryUrl === undefined);

  return { success, manifest, result, lines };
}
