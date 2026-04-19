/**
 * Write-Audit Chain — singleton HashAuditChain that records every
 * file-write performed by the hash-anchored / hashline edit tools.
 *
 * Each entry captures:
 *   - file path (relative when possible, absolute as fallback)
 *   - SHA-256 of file BEFORE the write
 *   - SHA-256 of file AFTER the write
 *   - timestamp (Date.now())
 *   - actor identifier (pid:sessionId or just pid)
 *
 * Chain integrity is enforced by `hash-audit-chain.ts`: each entry's
 * hash is computed over the previous entry's hash, so any post-hoc
 * tampering breaks verification. The chain is append-only in memory
 * with an optional `persistTo(path)` export for compliance reporting.
 *
 * Why a singleton: hashline + hash-anchored edits are two separate
 * tool implementations that must share the same audit chain (single
 * source of truth). A per-tool chain would leak the audit surface
 * and let a caller bypass tracking by switching tools.
 *
 * Opt-out: `WOTANN_WRITE_AUDIT_DISABLED=1` disables appends at the
 * tool layer. Reserved for tests where audit chain checks would
 * conflict with fixture isolation. Production must never set it.
 */

import { HashAuditChain, type AuditEntry } from "./hash-audit-chain.js";

let chain: HashAuditChain | null = null;

/**
 * Return the process-wide audit chain. Lazy-constructed so tests that
 * don't exercise writes never pay the init cost.
 */
export function getWriteAuditChain(): HashAuditChain {
  if (chain === null) {
    chain = new HashAuditChain();
  }
  return chain;
}

/**
 * Reset the singleton. Tests that need a clean audit chain per-run
 * call this in `beforeEach`. Production never calls this.
 */
export function resetWriteAuditChainForTests(): void {
  chain = null;
}

/**
 * Append a write-record to the audit chain. Wraps the raw
 * `HashAuditChain.append` so the record shape is uniform across both
 * edit tools — call-sites don't need to remember what fields to pass.
 *
 * Returns the appended entry (caller can log/telemetry it) or `null`
 * when the audit is disabled via the opt-out env var.
 */
export function recordWrite(input: {
  readonly file: string;
  readonly shaBefore: string;
  readonly shaAfter: string;
  readonly tool: "hashline_edit" | "hash_anchored_edit";
  readonly sessionId?: string;
}): AuditEntry | null {
  if (process.env["WOTANN_WRITE_AUDIT_DISABLED"] === "1") return null;
  const actor = input.sessionId ? `${process.pid}:${input.sessionId}` : String(process.pid);
  return getWriteAuditChain().append("file_write", actor, {
    file: input.file,
    shaBefore: input.shaBefore,
    shaAfter: input.shaAfter,
    tool: input.tool,
  });
}
