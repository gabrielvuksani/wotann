/**
 * Shared stub detection patterns.
 * Used by pre-completion-checklist, verification-enforcement, and forgecode-techniques.
 *
 * Extracted to eliminate copy-paste duplication across middleware files.
 */

/**
 * Patterns that indicate stub/TODO/placeholder code.
 * The pre-completion-checklist version uses these as RegExp patterns
 * for scanning file content before allowing completion claims.
 */
export const STUB_PATTERNS: readonly RegExp[] = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bHACK\b/,
  /\bXXX\b/,
  /throw new Error\(\s*["']Not implemented["']\s*\)/,
  /\/\/\s*stub\b/i,
  /\/\*\s*stub\b/i,
  /\bunimplemented!\(\)/,
  /\bpass\s*#\s*(?:TODO|stub)/i,
  /\bunimplemented\b/i,
  /\bplaceholder\b/i,
] as const;

/**
 * Scan content for stub/TODO markers.
 * Returns true if any stub pattern matches the content.
 */
export function containsStubMarkers(content: string): boolean {
  return STUB_PATTERNS.some((pattern) => pattern.test(content));
}
