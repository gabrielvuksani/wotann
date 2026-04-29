/**
 * Proof viewer: displays proof bundles after autonomous runs.
 * Shows test results, typecheck status, lint status, changed files,
 * screenshots, and overall duration with pass/fail coloring.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Palette } from "../themes.js";
import { PALETTES } from "../themes.js";
import { buildTone, type Tone } from "../theme/tokens.js";

// ── Types ──────────────────────────────────────────────────────

export interface ProofBundle {
  readonly tests: {
    readonly passed: number;
    readonly failed: number;
    readonly total: number;
  };
  readonly typecheck: boolean;
  readonly lintClean: boolean;
  readonly diffs: readonly string[];
  readonly screenshots: readonly string[];
  readonly duration: number;
}

interface ProofViewerProps {
  readonly proof: ProofBundle;
  /**
   * Active palette — wired from App so theme cycling carries through.
   * Falls back to the dark canonical palette when unset.
   */
  readonly palette?: Palette;
}

// ── Helpers ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function overallStatus(proof: ProofBundle, tone: Tone): { label: string; color: string } {
  const allTestsPass = proof.tests.failed === 0 && proof.tests.total > 0;
  const allClean = proof.typecheck && proof.lintClean;

  if (allTestsPass && allClean) {
    return { label: "ALL CHECKS PASSED", color: tone.success };
  }
  if (proof.tests.failed > 0) {
    return { label: "TESTS FAILED", color: tone.error };
  }
  if (!proof.typecheck) {
    return { label: "TYPE ERRORS", color: tone.error };
  }
  if (!proof.lintClean) {
    return { label: "LINT WARNINGS", color: tone.warning };
  }
  if (proof.tests.total === 0) {
    return { label: "NO TESTS RUN", color: tone.warning };
  }
  return { label: "INCOMPLETE", color: tone.warning };
}

function testBar(passed: number, failed: number, total: number, width: number = 20): string {
  if (total === 0) return "░".repeat(width);
  const passedWidth = Math.round((passed / total) * width);
  const failedWidth = Math.round((failed / total) * width);
  const remaining = width - passedWidth - failedWidth;
  return "█".repeat(passedWidth) + "▓".repeat(failedWidth) + "░".repeat(Math.max(0, remaining));
}

function statusIcon(ok: boolean, tone: Tone): { icon: string; color: string } {
  return ok ? { icon: "V", color: tone.success } : { icon: "X", color: tone.error };
}

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  // Show the end of the path (more useful for file identification)
  return "..." + path.slice(path.length - maxLen + 3);
}

// ── Component ──────────────────────────────────────────────────

export function ProofViewer({ proof, palette }: ProofViewerProps): React.ReactElement {
  const tone = buildTone(palette ?? PALETTES.dark);
  const status = overallStatus(proof, tone);
  const testPassRate =
    proof.tests.total > 0 ? Math.round((proof.tests.passed / proof.tests.total) * 100) : 0;
  const typeStatus = statusIcon(proof.typecheck, tone);
  const lintStatus = statusIcon(proof.lintClean, tone);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={status.color} paddingX={1}>
      {/* Header with overall status */}
      <Box gap={1} marginBottom={1}>
        <Text bold color={status.color}>
          Proof Bundle
        </Text>
        <Text dimColor>-</Text>
        <Text color={status.color} bold>
          {status.label}
        </Text>
        <Text dimColor>({formatDuration(proof.duration)})</Text>
      </Box>

      {/* Test results */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Tests:</Text>
        <Box gap={1} paddingLeft={2}>
          <Text color={proof.tests.failed === 0 ? tone.success : tone.error}>
            {testBar(proof.tests.passed, proof.tests.failed, proof.tests.total)}
          </Text>
          <Text dimColor>{testPassRate}%</Text>
        </Box>
        <Box gap={2} paddingLeft={2}>
          <Text color={tone.success}>{proof.tests.passed} passed</Text>
          {proof.tests.failed > 0 && <Text color={tone.error}>{proof.tests.failed} failed</Text>}
          <Text dimColor>{proof.tests.total} total</Text>
        </Box>
      </Box>

      {/* Typecheck and lint status */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Checks:</Text>
        <Box gap={1} paddingLeft={2}>
          <Text color={typeStatus.color}>[{typeStatus.icon}]</Text>
          <Text color={typeStatus.color}>
            TypeScript {proof.typecheck ? "clean" : "has errors"}
          </Text>
        </Box>
        <Box gap={1} paddingLeft={2}>
          <Text color={lintStatus.color}>[{lintStatus.icon}]</Text>
          <Text color={lintStatus.color}>Lint {proof.lintClean ? "clean" : "has warnings"}</Text>
        </Box>
      </Box>

      {/* Changed files */}
      {proof.diffs.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Changed Files ({proof.diffs.length}):</Text>
          {proof.diffs.map((diff, idx) => (
            <Box key={`diff-${idx}`} paddingLeft={2} gap={1}>
              <Text color={tone.warning}>M</Text>
              <Text>{truncatePath(diff, 60)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Screenshots */}
      {proof.screenshots.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Screenshots ({proof.screenshots.length}):</Text>
          {proof.screenshots.map((screenshot, idx) => (
            <Box key={`ss-${idx}`} paddingLeft={2} gap={1}>
              <Text color={tone.primary}>*</Text>
              <Text dimColor>{truncatePath(screenshot, 60)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Duration footer */}
      <Box gap={1}>
        <Text dimColor>Duration:</Text>
        <Text>{formatDuration(proof.duration)}</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Files:</Text>
        <Text>{proof.diffs.length}</Text>
        {proof.screenshots.length > 0 && (
          <>
            <Text dimColor>|</Text>
            <Text dimColor>Screenshots:</Text>
            <Text>{proof.screenshots.length}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
