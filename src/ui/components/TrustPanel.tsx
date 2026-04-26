/**
 * Trust panel — manage trusted-workspace allowlist (CVE-2026-33068 gate).
 *
 * Mirrors the `workspace.trust*` RPC handlers in src/daemon/kairos-rpc.ts
 * but calls the underlying utility functions directly because the TUI
 * runs in-process (no JSON-RPC client). Same source of truth on disk
 * (`~/.wotann/trusted-workspaces.json`) as the daemon, so changes from
 * either side are visible to the other.
 *
 * QB#6: fail-CLOSED — every error path leaves the trust set untouched
 * and surfaces a banner. Never silently mark a workspace trusted.
 *
 * Layout: Card with hash list (one per trusted workspace), an "Add cwd"
 * affordance, and j/k navigation. Enter on a row toggles trust for the
 * highlighted entry; A trusts the current cwd; Esc closes the panel.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar, Notification } from "./primitives/index.js";

interface TrustPanelProps {
  /** Current working directory — used for the "trust this workspace" affordance. */
  readonly workingDir: string;
  /** Close the panel — invoked on Esc and (optionally) after a destructive action. */
  readonly onClose: () => void;
}

interface TrustEntry {
  readonly hash: string;
  readonly isCurrent: boolean;
}

const MAX_VISIBLE = 12;

const FOOTER_HINTS = [
  { keys: "A", description: "trust cwd" },
  { keys: "Enter/D", description: "untrust" },
  { keys: "j/k", description: "navigate" },
  { keys: "R", description: "refresh" },
  { keys: "Esc", description: "close" },
];

interface TrustState {
  readonly entries: readonly TrustEntry[];
  readonly notice: {
    readonly kind: "info" | "success" | "warning" | "danger";
    readonly text: string;
  } | null;
}

const EMPTY_STATE: TrustState = { entries: [], notice: null };

/**
 * Compute the SHA-256 of the cwd's realpath so we can mark the row that
 * corresponds to the current workspace. Uses the same hashing helper
 * the daemon uses, keeping both sides in lockstep.
 */
async function loadCurrentHash(workingDir: string): Promise<string | null> {
  try {
    const mod = await import("../../utils/trusted-workspaces.js");
    return mod.workspaceHash(workingDir);
  } catch {
    return null;
  }
}

async function loadTrustState(workingDir: string): Promise<TrustState> {
  try {
    const mod = await import("../../utils/trusted-workspaces.js");
    const hashes = mod.listTrustedHashes();
    const currentHash = await loadCurrentHash(workingDir);
    const entries: readonly TrustEntry[] = hashes.map((hash) => ({
      hash,
      isCurrent: currentHash !== null && hash === currentHash,
    }));
    return { entries, notice: null };
  } catch (err) {
    return {
      entries: [],
      notice: {
        kind: "danger",
        text: `Failed to load trust list: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

export function TrustPanel({ workingDir, onClose }: TrustPanelProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [state, setState] = useState<TrustState>(EMPTY_STATE);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const refresh = useCallback((): void => {
    void loadTrustState(workingDir).then(setState);
  }, [workingDir]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const entries = state.entries;
  const clampedIndex = Math.min(selectedIndex, Math.max(0, entries.length - 1));

  const trustCwd = useCallback(async (): Promise<void> => {
    try {
      const mod = await import("../../utils/trusted-workspaces.js");
      const added = mod.trustWorkspace(workingDir);
      const next = await loadTrustState(workingDir);
      setState({
        entries: next.entries,
        notice: {
          kind: added ? "success" : "info",
          text: added
            ? `Added ${workingDir} to trusted workspaces.`
            : `Already trusted: ${workingDir}.`,
        },
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        notice: {
          kind: "danger",
          text: `Trust failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    }
  }, [workingDir]);

  const untrustSelected = useCallback(async (): Promise<void> => {
    const target = entries[clampedIndex];
    if (!target) return;
    try {
      const mod = await import("../../utils/trusted-workspaces.js");
      // The util's `untrustWorkspace(path)` only works when we have the
      // original path (it hashes then removes). We're holding the hash
      // directly, so use the public load/save API to drop the entry by
      // hash — same on-disk format, single source of truth.
      const set = mod.loadTrustedSet();
      if (!set.has(target.hash)) return;
      set.delete(target.hash);
      mod.saveTrustedSet(set);
      const next = await loadTrustState(workingDir);
      setState({
        entries: next.entries,
        notice: {
          kind: "success",
          text: `Removed trust for hash ${target.hash.slice(0, 12)}…`,
        },
      });
      setSelectedIndex((prev) => Math.max(0, Math.min(prev, next.entries.length - 1)));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        notice: {
          kind: "danger",
          text: `Untrust failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    }
  }, [entries, clampedIndex, workingDir]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(Math.max(0, entries.length - 1), prev + 1));
      return;
    }
    if (input === "a" || input === "A") {
      void trustCwd();
      return;
    }
    if (key.return || input === "d" || input === "D") {
      void untrustSelected();
      return;
    }
    if (input === "r" || input === "R") {
      refresh();
      return;
    }
  });

  const visibleStart = Math.max(0, clampedIndex - Math.floor(MAX_VISIBLE / 2));
  const visibleEntries = useMemo(
    () => entries.slice(visibleStart, visibleStart + MAX_VISIBLE),
    [entries, visibleStart],
  );

  return (
    <Card
      tone={tone}
      title="Trusted Workspaces"
      meta={`${entries.length} trusted`}
      accent="primary"
    >
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={tone.muted}>cwd:</Text>
          <Text color={tone.text}>{workingDir}</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {entries.length === 0 && (
            <Text color={tone.muted}>No trusted workspaces yet. Press A to trust the cwd.</Text>
          )}
          {visibleEntries.map((entry, displayIdx) => {
            const absoluteIdx = visibleStart + displayIdx;
            const isSelected = absoluteIdx === clampedIndex;
            return (
              <Box key={`trust-${entry.hash}`} gap={1}>
                <Text color={isSelected ? tone.primary : tone.border}>
                  {isSelected ? glyph.pointer : " "}
                </Text>
                <Text color={entry.isCurrent ? tone.success : tone.text} bold={isSelected}>
                  {entry.hash.slice(0, 16)}…
                </Text>
                {entry.isCurrent && <Text color={tone.success}>(this workspace)</Text>}
              </Box>
            );
          })}
        </Box>

        {state.notice !== null && (
          <Box marginTop={1}>
            <Notification tone={tone} kind={state.notice.kind} title={state.notice.text} />
          </Box>
        )}

        <Box marginTop={1}>
          <KeyHintBar bindings={FOOTER_HINTS} tone={tone} />
        </Box>
      </Box>
    </Card>
  );
}
