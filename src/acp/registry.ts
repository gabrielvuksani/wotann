/**
 * ACP registry submission — validator + submit/fallback flow (P1-C10).
 *
 * `manifest.ts` builds the object; this module **uses** it:
 *   - `validateManifest()`  — strict JSON-schema-style check against
 *                             upstream FORMAT.md. Never throws; returns
 *                             a structured `ValidationResult` so callers
 *                             can surface every problem in one pass.
 *   - `registerWithZed()`   — best-effort submission. Tries a network
 *                             POST when a registry URL + token are given;
 *                             otherwise (and on network failure) writes
 *                             the manifest locally and returns the path
 *                             plus a help URL so the user can PR it
 *                             manually per FORMAT.md.
 *
 * We never *silently* drop a submission — a failed POST still writes
 * the local copy so the user has something they can publish manually.
 * That's the honest-failure contract: network fallure -> local file +
 * explicit URL to submit via PR (QB #5).
 *
 * SECURITY: All outbound URLs go through `requireSafeUrl` so a
 * compromised-or-typoed registry URL can't trick WOTANN into posting
 * the manifest (which includes the user's package name + version) to
 * an internal endpoint.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireSafeUrl, SSRFBlockedError } from "../security/ssrf-guard.js";
import { ACP_PROTOCOL_VERSION } from "./protocol.js";
import type { AcpRegistryManifest } from "./manifest.js";

// Validation ────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Known platforms per FORMAT.md. A manifest that declares an unknown
 * platform gets a warning (not an error) — upstream may add platforms
 * ahead of us.
 */
const KNOWN_PLATFORMS = new Set([
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-aarch64",
  "linux-x86_64",
  "windows-aarch64",
  "windows-x86_64",
]);

/** ACP versions this WOTANN build knows about. Anything else -> warning. */
const SUPPORTED_ACP_VERSIONS: readonly number[] = [ACP_PROTOCOL_VERSION];

/**
 * Validate a manifest against the registry format. Does not throw; all
 * problems accumulate into `errors` (blocking) or `warnings` (non-blocking).
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be an object"], warnings: [] };
  }
  const m = manifest as Record<string, unknown>;

  // Required string fields ─────────────────────────────────
  for (const field of ["id", "name", "version", "description"] as const) {
    if (typeof m[field] !== "string" || (m[field] as string).length === 0) {
      errors.push(`missing or empty required field: ${field}`);
    }
  }

  // id must be kebab-case (FORMAT.md)
  if (typeof m["id"] === "string" && !/^[a-z0-9-]+$/.test(m["id"])) {
    errors.push(`id must be kebab-case (lower-alphanumeric + hyphens): got "${m["id"]}"`);
  }

  // version must be semver-ish (FORMAT.md)
  if (typeof m["version"] === "string" && !/^\d+\.\d+\.\d+/.test(m["version"])) {
    errors.push(`version must be semver (e.g. "0.4.0"): got "${m["version"]}"`);
  }

  // description length hint
  if (typeof m["description"] === "string" && m["description"].length > 160) {
    warnings.push(
      `description is ${m["description"].length} chars; FORMAT.md recommends <120 for registry UI`,
    );
  }

  // Distribution — at least one flavour required ──────────
  const dist = m["distribution"];
  if (!dist || typeof dist !== "object") {
    errors.push("distribution is required and must be an object");
  } else {
    const distObj = dist as Record<string, unknown>;
    const hasBinary = distObj["binary"] !== undefined;
    const hasNpx = distObj["npx"] !== undefined;
    const hasUvx = distObj["uvx"] !== undefined;
    if (!hasBinary && !hasNpx && !hasUvx) {
      errors.push("distribution must declare at least one of: binary, npx, uvx");
    }
    if (hasBinary) {
      errors.push(...validateBinary(distObj["binary"]).map((e) => `distribution.binary: ${e}`));
      warnings.push(
        ...validateBinary(distObj["binary"], true).map((e) => `distribution.binary: ${e}`),
      );
    }
    if (hasNpx) {
      errors.push(...validateNpx(distObj["npx"]).map((e) => `distribution.npx: ${e}`));
    }
    if (hasUvx) {
      errors.push(...validateUvx(distObj["uvx"]).map((e) => `distribution.uvx: ${e}`));
    }
  }

  // Capabilities block — optional, but if present must be valid ─
  if (m["capabilities"] !== undefined) {
    if (typeof m["capabilities"] !== "object" || m["capabilities"] === null) {
      errors.push("capabilities must be an object when provided");
    } else {
      const caps = m["capabilities"] as Record<string, unknown>;
      const acp = caps["acp"];
      if (acp === undefined) {
        warnings.push("capabilities.acp missing; IDEs may treat agent as non-ACP");
      } else if (typeof acp === "object" && acp !== null) {
        const acpObj = acp as Record<string, unknown>;
        if (typeof acpObj["version"] !== "number" || !Number.isInteger(acpObj["version"])) {
          errors.push("capabilities.acp.version must be an integer");
        } else if (!SUPPORTED_ACP_VERSIONS.includes(acpObj["version"] as number)) {
          warnings.push(
            `capabilities.acp.version=${acpObj["version"]} is not ${ACP_PROTOCOL_VERSION} (this build's ACP version); IDE may downgrade`,
          );
        }
        if (acpObj["transports"] !== undefined && !Array.isArray(acpObj["transports"])) {
          errors.push("capabilities.acp.transports must be an array when provided");
        }
      } else {
        errors.push("capabilities.acp must be an object");
      }
    }
  }

  // tags — optional array of strings
  if (m["tags"] !== undefined) {
    if (!Array.isArray(m["tags"]) || !m["tags"].every((t) => typeof t === "string")) {
      errors.push("tags must be an array of strings when provided");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateBinary(raw: unknown, warningsOnly = false): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object") {
    return warningsOnly ? [] : ["binary must be an object"];
  }
  const obj = raw as Record<string, unknown>;
  const platforms = obj["platforms"];
  if (!platforms || typeof platforms !== "object") {
    return warningsOnly ? [] : ["binary.platforms is required"];
  }
  for (const [platform, artifact] of Object.entries(platforms as Record<string, unknown>)) {
    if (!warningsOnly) {
      if (!artifact || typeof artifact !== "object") {
        out.push(`platforms.${platform} must be an object`);
        continue;
      }
      const art = artifact as Record<string, unknown>;
      if (typeof art["url"] !== "string") {
        out.push(`platforms.${platform}.url is required`);
      }
    } else if (!KNOWN_PLATFORMS.has(platform)) {
      out.push(`platforms.${platform} is not a known FORMAT.md platform`);
    }
  }
  return out;
}

function validateNpx(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object") return ["must be an object"];
  const obj = raw as Record<string, unknown>;
  if (typeof obj["package"] !== "string" || obj["package"].length === 0) {
    out.push("package is required");
  }
  if (obj["args"] !== undefined) {
    if (!Array.isArray(obj["args"]) || !obj["args"].every((a) => typeof a === "string")) {
      out.push("args must be an array of strings when provided");
    }
  }
  return out;
}

function validateUvx(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object") return ["must be an object"];
  const obj = raw as Record<string, unknown>;
  if (typeof obj["package"] !== "string" || obj["package"].length === 0) {
    out.push("package is required");
  }
  if (obj["args"] !== undefined) {
    if (!Array.isArray(obj["args"]) || !obj["args"].every((a) => typeof a === "string")) {
      out.push("args must be an array of strings when provided");
    }
  }
  return out;
}

// Submission ────────────────────────────────────────────────

export type RegisterStatus =
  | "SUBMITTED" // POST succeeded (2xx)
  | "LOCAL-ONLY" // No URL given, OR dryRun, OR POST failed -> wrote to disk
  | "VALIDATION-FAILED" // manifest.validateManifest returned errors
  | "BLOCKED-URL"; // URL was SSRF-blocked

export interface RegisterOptions {
  /** Absolute path to write the manifest to when we can't POST (or as a record). */
  readonly manifestOutPath: string;
  /** Registry URL to POST the manifest to. Omit for local-only. */
  readonly registryUrl?: string;
  /** Bearer token for the registry. Only used when `registryUrl` is set. */
  readonly registryToken?: string;
  /** When true, skip the network entirely — just write the manifest locally. */
  readonly dryRun?: boolean;
  /**
   * Pluggable fetch. Tests inject a deterministic one; production uses the
   * global `fetch`. SSRF is checked before calling this, so the injected
   * fetch can't be used to bypass security.
   */
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface RegisterResult {
  readonly status: RegisterStatus;
  /** Absolute path to the manifest on disk (always set when we wrote one). */
  readonly manifestPath?: string;
  /** URL the manifest would/did ship to, for user-visible logging. */
  readonly registryUrl?: string;
  /** Error detail (network failure, SSRF rejection, validation errors, ...). */
  readonly reason?: string;
  /** Help URL the user can visit to submit manually when we wrote local-only. */
  readonly manualSubmitUrl: string;
  /** Validation errors (present when status === "VALIDATION-FAILED"). */
  readonly validationErrors?: readonly string[];
  /** Validation warnings (always surfaced, even on success). */
  readonly validationWarnings: readonly string[];
}

/** GitHub PR URL to submit a manifest manually when network publishing isn't viable. */
export const REGISTRY_MANUAL_SUBMIT_URL =
  "https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md";

/**
 * Submit `manifest` to a Zed/JetBrains/Air ACP registry. Always
 * writes the manifest locally, even on successful POST, so there's a
 * cached copy for debugging. Network failures fall back to
 * "LOCAL-ONLY" — never throws on a transport error.
 *
 * Validation runs first; if the manifest is invalid the function
 * returns immediately with `VALIDATION-FAILED` and does NOT touch disk
 * or network (don't write bad artefacts).
 */
export async function registerWithZed(
  manifest: AcpRegistryManifest,
  options: RegisterOptions,
): Promise<RegisterResult> {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    return {
      status: "VALIDATION-FAILED",
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
      reason: `Manifest failed validation: ${validation.errors.join("; ")}`,
    };
  }

  // Write locally — always. Even on POST success we keep a copy so the
  // user can see exactly what went out.
  const manifestPath = writeManifestToDisk(manifest, options.manifestOutPath);

  // Dry run OR no URL -> local-only path, done.
  if (options.dryRun === true || !options.registryUrl) {
    return {
      status: "LOCAL-ONLY",
      manifestPath,
      validationWarnings: validation.warnings,
      manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
      ...(options.registryUrl ? { registryUrl: options.registryUrl } : {}),
    };
  }

  // SSRF gate — reject obviously-bad URLs before we ship the body.
  try {
    requireSafeUrl(options.registryUrl);
  } catch (err) {
    const reason = err instanceof SSRFBlockedError ? err.message : String(err);
    return {
      status: "BLOCKED-URL",
      manifestPath,
      registryUrl: options.registryUrl,
      reason: `SSRF guard rejected registry URL: ${reason}`,
      validationWarnings: validation.warnings,
      manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
    };
  }

  // POST the manifest. Any transport failure -> LOCAL-ONLY with reason.
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.registryToken) {
      headers["authorization"] = `Bearer ${options.registryToken}`;
    }
    const response = await fetchImpl(options.registryUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(manifest),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "LOCAL-ONLY",
        manifestPath,
        registryUrl: options.registryUrl,
        reason: `HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
        validationWarnings: validation.warnings,
        manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
      };
    }
    return {
      status: "SUBMITTED",
      manifestPath,
      registryUrl: options.registryUrl,
      validationWarnings: validation.warnings,
      manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
    };
  } catch (err) {
    return {
      status: "LOCAL-ONLY",
      manifestPath,
      registryUrl: options.registryUrl,
      reason: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      validationWarnings: validation.warnings,
      manualSubmitUrl: REGISTRY_MANUAL_SUBMIT_URL,
    };
  }
}

// Disk write ────────────────────────────────────────────────

/**
 * Write the manifest to `path`. Creates parent dirs as needed. Returns
 * the absolute path. Never returns undefined — any I/O failure
 * propagates as a thrown error (the caller is expected to surface it
 * to the user; there's nothing meaningful to recover from if the
 * filesystem is write-blocked).
 */
export function writeManifestToDisk(manifest: AcpRegistryManifest, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return path;
}
